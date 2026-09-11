const assert = require('assert');
const { db, initializeDatabase } = require('../src/config/database');
const participantService = require('../src/services/participantService');
const roomService = require('../src/services/roomService');
const verificationService = require('../src/services/verificationService');
const runSeeder = require('../src/seed/seeder');

async function runTests() {
  console.log('>>> MEMULAI AUTOMATED TESTING SISTEM SIDANG MUSPIMNAS <<<');

  // 1. Run Seeder
  await runSeeder();

  // 2. Check Rooms
  const rooms = roomService.getAllRooms();
  console.log(`[PASS] Master Ruang Sidang ditemukan: ${rooms.length} ruangan`);
  assert(rooms.length >= 3, 'Minimal 3 ruangan harus ada');
  const room1 = rooms[0];
  const room2 = rooms[1];

  // 3. Create a test participant
  const testNum = 'TEST-' + Date.now();
  const newParticipant = participantService.createParticipant({
    name: 'Peserta Uji Otomatis',
    identifier_num: testNum,
    institution: 'Delegasi Testing',
    roomId: room1.id
  });
  console.log(`[PASS] Peserta baru berhasil dibuat dengan UUID token: ${newParticipant.qr_token}`);
  assert(newParticipant.qr_token && newParticipant.qr_token.length === 36, 'Token harus berupa UUID v4 36 karakter');
  assert(newParticipant.room_id === room1.id, 'Alokasi ruangan harus sesuai');

  // 4. Test Bulk Room Assignment
  const p2Num = 'TEST2-' + Date.now();
  const p2 = participantService.createParticipant({
    name: 'Peserta Uji 2',
    identifier_num: p2Num,
    institution: 'Delegasi Testing 2'
  });
  const bulkRes = participantService.bulkAssignRoom([newParticipant.id, p2.id], room2.id);
  console.log(`[PASS] Bulk Assignment sukses: ${bulkRes.updatedCount} peserta dipindah ke ${bulkRes.roomName}`);
  assert.strictEqual(bulkRes.updatedCount, 2);

  // Participant now belongs to room2
  const updatedP = participantService.getParticipantById(newParticipant.id);
  assert.strictEqual(updatedP.room_id, room2.id);

  // 5. Test ID Card Generator Data
  const printCards = await participantService.getParticipantsForPrint([newParticipant.id]);
  assert(printCards.length === 1);
  assert(printCards[0].qrDataUrl.startsWith('data:image/png;base64,'));
  console.log(`[PASS] QR Code DataURI ID Card berhasil di-generate secara otomatis`);

  // 6. Test Verification Engine - Rule 1: Non-existent QR Token
  const resInvalid = verificationService.verifyScan('invalid-fake-uuid-0000', room2.id);
  console.log(`[PASS] Uji Token Tidak Valid: status=${resInvalid.status}, message="${resInvalid.message}"`);
  assert.strictEqual(resInvalid.status, 'INVALID_TOKEN');
  assert.strictEqual(resInvalid.success, false);

  // 7. Test Verification Engine - Rule 2: Wrong Room (Entering room1 instead of room2)
  const resWrongRoom = verificationService.verifyScan(newParticipant.qr_token, room1.id);
  console.log(`[PASS] Uji Salah Ruangan: status=${resWrongRoom.status}, message="${resWrongRoom.message}"`);
  assert.strictEqual(resWrongRoom.status, 'WRONG_ROOM');
  assert.strictEqual(resWrongRoom.success, false);
  assert.strictEqual(resWrongRoom.participant.correct_room, room2.room_name);

  // 8. Test Verification Engine - Rule 3: Valid Access (Entering room2)
  const resSuccess = verificationService.verifyScan(newParticipant.qr_token, room2.id);
  console.log(`[PASS] Uji Akses Diterima: status=${resSuccess.status}, message="${resSuccess.message}"`);
  assert.strictEqual(resSuccess.status, 'SUCCESS');
  assert.strictEqual(resSuccess.success, true);
  assert(resSuccess.participant.attended_at !== null);

  // 9. Test Verification Engine - Rule 4: Anti-Double Scan (Attempting to scan again)
  const resDuplicate = verificationService.verifyScan(newParticipant.qr_token, room2.id);
  console.log(`[PASS] Uji Anti-Dobel Scan: status=${resDuplicate.status}, message="${resDuplicate.message}"`);
  assert.strictEqual(resDuplicate.status, 'ALREADY_ATTENDED');
  assert.strictEqual(resDuplicate.success, false);

  // 10. Clean up test records
  participantService.deleteParticipant(newParticipant.id);
  participantService.deleteParticipant(p2.id);
  console.log(`[PASS] Pembersihan data pengujian berhasil`);

  console.log('\n>>> SEMUA 10 PENGUJIAN OTOMATIS BERHASIL 100% TANPA KESALAHAN! <<<');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
