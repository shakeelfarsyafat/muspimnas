const assert = require('assert');

async function testHttpFlow() {
  console.log('>>> MEMULAI END-TO-END HTTP INTEGRATION TEST <<<');
  const baseUrl = 'http://localhost:3000';

  // 1. Test GET /login
  const loginPageRes = await fetch(`${baseUrl}/login`);
  assert.strictEqual(loginPageRes.status, 200);
  const loginHtml = await loginPageRes.text();
  assert(loginHtml.includes('MUSPIMNAS'));
  assert(loginHtml.includes('Sistem Manajemen Peserta Sidang & Verifikasi QR'));
  console.log('[PASS] GET /login render HTML sukses (Status 200)');

  // 2. Test POST /login with admin / admin123
  const loginPostRes = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=admin123',
    redirect: 'manual'
  });

  const setCookie = loginPostRes.headers.get('set-cookie');
  assert(setCookie, 'Login harus mengembalikan session cookie');
  const cookie = setCookie.split(';')[0];
  console.log('[PASS] POST /login berhasil mengautentikasi dan mengembalikan session cookie');

  // 3. Test GET /dashboard with session cookie
  const dashboardRes = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: cookie }
  });
  assert.strictEqual(dashboardRes.status, 200);
  const dashboardHtml = await dashboardRes.text();
  assert(dashboardHtml.includes('Dashboard Manajemen Peserta Sidang'));
  assert(dashboardHtml.includes('floating-bulk-toolbar'));
  console.log('[PASS] GET /dashboard terotentikasi sukses dengan data peserta');

  // 4. Test GET /rooms
  const roomsRes = await fetch(`${baseUrl}/rooms`, {
    headers: { Cookie: cookie }
  });
  assert.strictEqual(roomsRes.status, 200);
  const roomsHtml = await roomsRes.text();
  assert(roomsHtml.includes('Manajemen Ruangan Sidang & Sesi'));
  console.log('[PASS] GET /rooms sukses menampilkan statistik ruangan');

  // 5. Test GET /print?ids=all
  const printRes = await fetch(`${baseUrl}/print?ids=all`, {
    headers: { Cookie: cookie }
  });
  assert.strictEqual(printRes.status, 200);
  const printHtml = await printRes.text();
  assert(printHtml.includes('Tanda Pengenal Peserta Sidang'));
  assert(printHtml.includes('data:image/png;base64,'));
  console.log('[PASS] GET /print?ids=all sukses me-render seluruh kartu peserta dengan QR Code');

  // 6. Test GET /scanner
  const scannerRes = await fetch(`${baseUrl}/scanner`, {
    headers: { Cookie: cookie }
  });
  assert.strictEqual(scannerRes.status, 200);
  const scannerHtml = await scannerRes.text();
  assert(scannerHtml.includes('Terminal Verifikasi Pintu Sidang'));
  assert(scannerHtml.includes('hardware-scanner-input'));
  assert(scannerHtml.includes('camera-reader-viewport'));
  console.log('[PASS] GET /scanner sukses me-render antarmuka hybrid scanner');

  // 7. Test POST /api/verify/scan via HTTP
  // Fetch one participant from DB to test scan
  const { db } = require('../src/config/database');
  const sampleParticipant = db.prepare(`
    SELECT p.qr_token, ra.room_id 
    FROM participants p
    JOIN room_allocations ra ON p.id = ra.participant_id
    WHERE ra.is_attended = 0
    LIMIT 1
  `).get();

  if (sampleParticipant) {
    const scanRes = await fetch(`${baseUrl}/api/verify/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        qr_token: sampleParticipant.qr_token,
        room_id: sampleParticipant.room_id
      })
    });

    const scanData = await scanRes.json();
    assert.strictEqual(scanData.status, 'SUCCESS');
    assert.strictEqual(scanData.success, true);
    console.log(`[PASS] POST /api/verify/scan berhasil memverifikasi peserta: ${scanData.participant.name}`);

    // Try scanning same participant again -> must return ALREADY_ATTENDED
    const doubleScanRes = await fetch(`${baseUrl}/api/verify/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        qr_token: sampleParticipant.qr_token,
        room_id: sampleParticipant.room_id
      })
    });

    const doubleData = await doubleScanRes.json();
    assert.strictEqual(doubleData.status, 'ALREADY_ATTENDED');
    console.log(`[PASS] POST /api/verify/scan anti-dobel scan bekerja: ${doubleData.message}`);
  }

  console.log('\n>>> SELURUH END-TO-END HTTP INTEGRATION TEST BERHASIL 100%! <<<');
}

testHttpFlow().catch(err => {
  console.error('HTTP Test failed:', err);
  process.exit(1);
});
