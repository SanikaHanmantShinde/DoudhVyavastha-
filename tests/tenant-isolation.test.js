import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const canUseDatabase = Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET)

test('one dairy cannot list, read, update, or delete another dairy producer', {
  skip: !canUseDatabase && 'Set DATABASE_URL and SESSION_SECRET and run migrations to run the PostgreSQL isolation test.',
}, async (t) => {
  const [{ default: app }, { default: request }, { pool }] = await Promise.all([
    import('../server/app.js'),
    import('supertest'),
    import('../server/db.js'),
  ])
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const phoneSuffix = randomUUID().replace(/\D/g, '').slice(0, 7).padEnd(7, '0')
  const owners = [
    { email: `owner-a-${suffix}@example.test`, mobile: `+15550${phoneSuffix}`, name: 'Dairy A' },
    { email: `owner-b-${suffix}@example.test`, mobile: `+16660${phoneSuffix}`, name: 'Dairy B' },
  ]
  const agents = owners.map(() => request.agent(app))

  const health = await request(app).get('/api/health')
  assert.equal(health.status, 200, health.text)
  assert.deepEqual(health.body, { status: 'ok' })

  async function createAccount(agent, owner, withProfilePhoto = false) {
    const csrf = await agent.get('/api/auth/csrf')
    assert.equal(csrf.status, 200)
    const registrationRequest = agent.post('/api/auth/register')
      .set('X-CSRF-Token', csrf.body.csrfToken)
    const fields = {
      fullName: owner.name,
      dairyName: owner.name,
      email: owner.email,
      mobile: owner.mobile,
      password: 'a long test-only password',
      confirmPassword: 'a long test-only password',
      village: 'Test village',
      address: '',
      consent: true,
    }
    if (withProfilePhoto) {
      for (const [field, value] of Object.entries({ ...fields, consent: 'true' })) {
        registrationRequest.field(field, String(value))
      }
      registrationRequest.attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      })
    } else {
      registrationRequest.send(fields)
    }
    const registration = await registrationRequest
    assert.equal(registration.status, 201, registration.text)
    const login = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ identity: owner.email, password: 'a long test-only password' })
    assert.equal(login.status, 200, login.text)
    const freshCsrf = await agent.get('/api/auth/csrf')
    assert.equal(freshCsrf.status, 200)
    return freshCsrf.body.csrfToken
  }

  let tokens
  let producerId
  const sessionDate = new Date().toISOString().slice(0, 10)
  t.after(async () => {
    try {
      await pool.query(
        `DELETE FROM session WHERE sess->>'userId' IN (
          SELECT id::text FROM users WHERE email = ANY($1)
        )`,
        [owners.map((owner) => owner.email)],
      )
      await pool.query(
        `DELETE FROM dairies WHERE id IN (
          SELECT m.dairy_id FROM dairy_memberships m
          JOIN users u ON u.id = m.user_id WHERE u.email = ANY($1)
        )`,
        [owners.map((owner) => owner.email)],
      )
      await pool.query('DELETE FROM users WHERE email = ANY($1)', [owners.map((owner) => owner.email)])
    } finally {
      await pool.end()
    }
  })

  tokens = await Promise.all(agents.map((agent, index) => createAccount(agent, owners[index], index === 0)))
  const initialProfile = await agents[0].get('/api/private/me')
  assert.equal(initialProfile.body.user.photoUrl, '/api/private/me/photo')
  const registrationPhoto = await agents[0].get(initialProfile.body.user.photoUrl)
  assert.equal(registrationPhoto.status, 200)
  assert.equal(registrationPhoto.headers['content-type'], 'image/jpeg')
  const otherRegistrationPhoto = await agents[1].get(initialProfile.body.user.photoUrl)
  assert.equal(otherRegistrationPhoto.status, 404)
  const removedRegistrationPhoto = await agents[0].delete('/api/private/me/photo')
    .set('X-CSRF-Token', tokens[0])
  assert.equal(removedRegistrationPhoto.status, 204)
  const profileWithoutPhoto = await agents[0].get('/api/private/me')
  assert.equal(profileWithoutPhoto.body.user.photoUrl, null)
  const profileUpload = await agents[0].post('/api/private/me/photo')
    .set('X-CSRF-Token', tokens[0])
    .attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'profile.jpg', contentType: 'image/jpeg' })
  assert.equal(profileUpload.status, 200, profileUpload.text)
  assert.equal(profileUpload.body.photoUrl, '/api/private/me/photo')
  const updatedProfile = await agents[0].get('/api/private/me')
  assert.equal(updatedProfile.body.user.photoUrl, '/api/private/me/photo')
  const ownProfilePhoto = await agents[0].get(profileUpload.body.photoUrl)
  assert.equal(ownProfilePhoto.status, 200)
  assert.equal(ownProfilePhoto.headers['content-type'], 'image/jpeg')
  assert.equal(ownProfilePhoto.headers['cache-control'], 'private, no-store')
  const otherProfilePhoto = await agents[1].get(profileUpload.body.photoUrl)
  assert.equal(otherProfilePhoto.status, 404)
  const removedProfilePhoto = await agents[0].delete('/api/private/me/photo')
    .set('X-CSRF-Token', tokens[0])
  assert.equal(removedProfilePhoto.status, 204)
  const profileAfterRemoval = await agents[0].get('/api/private/me')
  assert.equal(profileAfterRemoval.body.user.photoUrl, null)
  for (let index = 0; index < agents.length; index += 1) {
    const session = await agents[index].post('/api/private/sessions')
      .set('X-CSRF-Token', tokens[index])
      .send({ sessionDate, sessionType: 'MORNING' })
    assert.equal(session.status, 201, session.text)
  }
  const created = await agents[0].post('/api/private/producers')
    .set('X-CSRF-Token', tokens[0])
    .send({ producerCode: 'SHARED-1', name: 'Producer A', mobile: '', village: 'Village A', address: '', notes: '' })
  assert.equal(created.status, 201, created.text)
  assert.match(created.body.item.producer_code, /^P-\d{4,}$/)
  assert.equal(created.body.item.is_active, true)
  producerId = created.body.item.id
  const uploadedPhoto = await agents[0].post(`/api/private/producers/${producerId}/photo`)
    .set('X-CSRF-Token', tokens[0])
    .attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'producer.jpg', contentType: 'image/jpeg' })
  assert.equal(uploadedPhoto.status, 200, uploadedPhoto.text)
  const ownPhoto = await agents[0].get(uploadedPhoto.body.photoUrl)
  assert.equal(ownPhoto.status, 200)
  assert.equal(ownPhoto.headers['content-type'], 'image/jpeg')
  const otherPhoto = await agents[1].get(uploadedPhoto.body.photoUrl)
  assert.equal(otherPhoto.status, 404)
  const oversizedPhoto = await agents[0].post(`/api/private/producers/${producerId}/photo`)
    .set('X-CSRF-Token', tokens[0])
    .attach('photo', Buffer.alloc((2 * 1024 * 1024) + 1), { filename: 'too-large.jpg', contentType: 'image/jpeg' })
  assert.equal(oversizedPhoto.status, 413)
  const removedPhoto = await agents[0].delete(`/api/private/producers/${producerId}/photo`)
    .set('X-CSRF-Token', tokens[0])
  assert.equal(removedPhoto.status, 204)
  const pendingProducer = await agents[0].post('/api/private/producers')
    .set('X-CSRF-Token', tokens[0])
    .send({ name: 'Pending Producer', mobile: '', village: 'Village A', address: '', notes: '' })
  assert.equal(pendingProducer.status, 201, pendingProducer.text)

  const otherList = await agents[1].get('/api/private/producers')
  assert.equal(otherList.status, 200)
  assert.deepEqual(otherList.body.items, [])

  const otherRead = await agents[1].get(`/api/private/producers/${producerId}`)
  assert.notEqual(otherRead.status, 200)

  const otherUpdate = await agents[1].put(`/api/private/producers/${producerId}`)
    .set('X-CSRF-Token', tokens[1])
    .send({ producerCode: 'STOLEN', name: 'Modified', mobile: '', village: 'Village B', address: '', notes: '' })
  assert.equal(otherUpdate.status, 404)

  const otherDelete = await agents[1].delete(`/api/private/producers/${producerId}`)
    .set('X-CSRF-Token', tokens[1])
  assert.equal(otherDelete.status, 404)

  const sameCode = await agents[1].post('/api/private/producers')
    .set('X-CSRF-Token', tokens[1])
    .send({ producerCode: 'SHARED-1', name: 'Producer B', mobile: '', village: 'Village B', address: '', notes: '' })
  assert.equal(sameCode.status, 201, sameCode.text)
  const deactivated = await agents[1].patch(`/api/private/producers/${sameCode.body.item.id}/status`)
    .set('X-CSRF-Token', tokens[1])
    .send({ isActive: false })
  assert.equal(deactivated.status, 200, deactivated.text)
  assert.equal(deactivated.body.item.is_active, false)
  const activeProducers = await agents[1].get('/api/private/producers?status=active')
  assert.equal(activeProducers.status, 200, activeProducers.text)
  assert.deepEqual(activeProducers.body.items, [])
  const inactiveProducers = await agents[1].get('/api/private/producers?status=inactive')
  assert.equal(inactiveProducers.status, 200, inactiveProducers.text)
  assert.deepEqual(inactiveProducers.body.items.map((item) => item.id), [sameCode.body.item.id])
  const allProducers = await agents[1].get('/api/private/producers?status=all')
  assert.equal(allProducers.status, 200, allProducers.text)
  assert.deepEqual(allProducers.body.items.map((item) => item.id), [sameCode.body.item.id])

  const rateRule = {
    milkType: 'COW',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    fatMin: 3,
    fatMax: 5,
    snfMin: 7,
    snfMax: 9,
    ratePerLitre: 31.25,
  }
  for (const agentIndex of [0, 1]) {
    const rate = await agents[agentIndex].post('/api/private/rate-rules')
      .set('X-CSRF-Token', tokens[agentIndex])
      .send(rateRule)
    assert.equal(rate.status, 201, rate.text)
  }
  const chartPreview = await agents[0].post('/api/private/rate-rules/import-preview')
    .set('X-CSRF-Token', tokens[0])
    .attach('file', Buffer.from('Fat,SNF,Rate\n1%,5%,"₹1,234.50"\n', 'utf8'), { filename: 'cow-rates.csv', contentType: 'text/csv' })
  assert.equal(chartPreview.status, 200, chartPreview.text)
  assert.equal(chartPreview.body.rows.length, 1)
  assert.equal(chartPreview.body.rows[0].ratePerLitre, 1234.5)
  const chartImport = await agents[0].post('/api/private/rate-rules/import')
    .set('X-CSRF-Token', tokens[0])
    .send({ milkType: 'COW', effectiveFrom: '2099-01-01', rows: chartPreview.body.rows })
  assert.equal(chartImport.status, 201, chartImport.text)
  assert.equal(chartImport.body.items.length, 1)
  const milkQuote = await agents[0].post('/api/private/milk-quote')
    .set('X-CSRF-Token', tokens[0])
    .send({
      sessionDate,
      milkType: 'COW',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
    })
  assert.equal(milkQuote.status, 200, milkQuote.text)
  assert.deepEqual(milkQuote.body, {
    quantity: '10.000',
    rate: '31.2500',
    amount: '312.50',
    noSupply: false,
  })
  const unmatchedMilkQuote = await agents[0].post('/api/private/milk-quote')
    .set('X-CSRF-Token', tokens[0])
    .send({
      sessionDate,
      milkType: 'BUFFALO',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
    })
  assert.equal(unmatchedMilkQuote.status, 422)
  const milkEntry = await agents[0].post('/api/private/milk-entries')
    .set('X-CSRF-Token', tokens[0])
    .send({
      producerId: producerId,
      sessionDate,
      sessionType: 'MORNING',
      collectedAt: new Date().toISOString(),
      milkType: 'COW',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
      notes: '',
    })
  assert.equal(milkEntry.status, 201, milkEntry.text)
  const duplicateMilkEntry = await agents[0].post('/api/private/milk-entries')
    .set('X-CSRF-Token', tokens[0])
    .send({
      producerId,
      sessionDate,
      sessionType: 'MORNING',
      collectedAt: new Date().toISOString(),
      milkType: 'COW',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
      notes: '',
    })
  assert.equal(duplicateMilkEntry.status, 409, duplicateMilkEntry.text)
  const zeroSupplyEntry = await agents[0].post('/api/private/milk-entries')
    .set('X-CSRF-Token', tokens[0])
    .send({
      producerId,
      sessionDate,
      sessionType: 'MORNING',
      collectedAt: new Date().toISOString(),
      milkType: 'BUFFALO',
      startReading: 5,
      endReading: 5,
      fat: 0,
      snf: 0,
      noSupply: true,
      notes: 'Producer explicitly reported no milk.',
    })
  assert.equal(zeroSupplyEntry.status, 201, zeroSupplyEntry.text)
  assert.equal(zeroSupplyEntry.body.item.quantity_litres, '0.000')
  assert.equal(zeroSupplyEntry.body.item.amount, '0.00')

  const feedItem = await agents[0].post('/api/private/feed-items')
    .set('X-CSRF-Token', tokens[0])
    .send({ itemCode: 'TEST-FEED', name: 'Test feed', rate: 10, unit: 'kg', description: '' })
  assert.equal(feedItem.status, 201, feedItem.text)
  const feedIssue = await agents[0].post('/api/private/feed-issues')
    .set('X-CSRF-Token', tokens[0])
    .send({ producerId, feedItemId: feedItem.body.item.id, issueDate: sessionDate, quantity: 2, ratePerUnit: 10, remarks: 'Test issue' })
  assert.equal(feedIssue.status, 201, feedIssue.text)
  assert.equal(feedIssue.body.item.amount, '20.00')
  const advance = await agents[0].post('/api/private/advances')
    .set('X-CSRF-Token', tokens[0])
    .send({ producerId, advanceDate: sessionDate, amount: 10, remarks: 'Test advance' })
  assert.equal(advance.status, 201, advance.text)
  const rejectedOverpayment = await agents[0].post('/api/private/payments')
    .set('X-CSRF-Token', tokens[0])
    .send({ producerId, paymentDate: sessionDate, amount: 1000000, remarks: '' })
  assert.equal(rejectedOverpayment.status, 422)
  const payment = await agents[0].post('/api/private/payments')
    .set('X-CSRF-Token', tokens[0])
    .send({ producerId, paymentDate: sessionDate, amount: 50, remarks: 'Test settlement' })
  assert.equal(payment.status, 201, payment.text)
  const statement = await agents[0].get(`/api/private/producer-statement?${new URLSearchParams({ producerId, from: sessionDate, to: sessionDate })}`)
  assert.equal(statement.status, 200, statement.text)
  assert.equal(statement.body.totals.feedAmount, 20)
  assert.equal(statement.body.totals.advanceAmount, 10)
  assert.equal(statement.body.totals.paymentAmount, 50)
  assert.equal(statement.body.totals.balance, 232.5)
  const balances = await agents[0].get('/api/private/producer-balances')
  assert.equal(balances.status, 200)
  assert.equal(Number(balances.body.items.find((item) => item.id === producerId).balance), 232.5)
  const otherStatement = await agents[1].get(`/api/private/producer-statement?${new URLSearchParams({ producerId, from: sessionDate, to: sessionDate })}`)
  assert.equal(otherStatement.status, 404)
  const otherIssues = await agents[1].get('/api/private/feed-issues')
  assert.deepEqual(otherIssues.body.items, [])
  const otherAdvances = await agents[1].get('/api/private/advances')
  assert.deepEqual(otherAdvances.body.items, [])
  const otherPayments = await agents[1].get('/api/private/payments')
  assert.deepEqual(otherPayments.body.items, [])
  const voidedAdvance = await agents[0].post(`/api/private/advances/${advance.body.item.id}/void`)
    .set('X-CSRF-Token', tokens[0])
  assert.equal(voidedAdvance.status, 200, voidedAdvance.text)
  const updatedBalances = await agents[0].get('/api/private/producer-balances')
  assert.equal(Number(updatedBalances.body.items.find((item) => item.id === producerId).balance), 242.5)

  const otherMilkList = await agents[1].get('/api/private/milk-entries')
  assert.equal(otherMilkList.status, 200)
  assert.deepEqual(otherMilkList.body.items, [])
  const otherMilkRead = await agents[1].get(`/api/private/milk-entries/${milkEntry.body.item.id}`)
  assert.equal(otherMilkRead.status, 404)
  const otherMilkUpdate = await agents[1].put(`/api/private/milk-entries/${milkEntry.body.item.id}`)
    .set('X-CSRF-Token', tokens[1])
    .send({
      producerId: sameCode.body.item.id,
      sessionDate,
      sessionType: 'MORNING',
      collectedAt: new Date().toISOString(),
      milkType: 'COW',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
      notes: '',
    })
  assert.equal(otherMilkUpdate.status, 404)
  const otherMilkDelete = await agents[1].delete(`/api/private/milk-entries/${milkEntry.body.item.id}`)
    .set('X-CSRF-Token', tokens[1])
  assert.equal(otherMilkDelete.status, 404)

  const sessions = await agents[0].get(`/api/private/sessions?date=${sessionDate}`)
  assert.equal(sessions.status, 200)
  const morning = sessions.body.sessions.find((item) => item.session_type === 'MORNING')
  assert.equal(morning.status, 'OPEN')
  assert.equal(morning.supplied_count, 1)
  assert.equal(morning.pending_count, 1)

  const closed = await agents[0].post(`/api/private/sessions/${morning.session_id}/close`)
    .set('X-CSRF-Token', tokens[0])
  assert.equal(closed.status, 200, closed.text)
  const closedSessionWrite = await agents[0].post('/api/private/milk-entries')
    .set('X-CSRF-Token', tokens[0])
    .send({
      producerId,
      sessionDate,
      sessionType: 'MORNING',
      collectedAt: new Date().toISOString(),
      milkType: 'BUFFALO',
      startReading: 1,
      endReading: 11,
      fat: 4.2,
      snf: 8.1,
      notes: '',
    })
  assert.equal(closedSessionWrite.status, 409, closedSessionWrite.text)
  const reopen = await agents[0].post(`/api/private/sessions/${morning.session_id}/reopen`)
    .set('X-CSRF-Token', tokens[0])
  assert.equal(reopen.status, 200, reopen.text)

  const ownerList = await agents[0].get('/api/private/producers')
  assert.equal(ownerList.status, 200)
  assert.deepEqual(ownerList.body.items.map((item) => item.id).sort(), [producerId, pendingProducer.body.item.id].sort())
  const ownerMilk = await agents[0].get('/api/private/milk-entries')
  assert.deepEqual(ownerMilk.body.items.map((item) => item.id).sort(), [milkEntry.body.item.id, zeroSupplyEntry.body.item.id].sort())
})
