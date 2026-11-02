import { roomStore } from '../src/state/RoomStore.js';
import assert from 'assert';

console.log('🧪 Starting Collaborative Music Room Core Logic Tests...\n');

// Test 1: Room Creation & 6-digit Code
console.log('Test 1: Room Creation & Code Generation');
const room = roomStore.createRoom('user_1', 'sock_1', 'Alice (Host)', '#6366f1');
assert.ok(room.code, 'Room code should exist');
assert.strictEqual(room.code.length, 6, 'Room code must be 6 digits');
assert.strictEqual(room.hostId, 'user_1', 'Host ID matches creator');
assert.strictEqual(room.members.size, 1, 'Room should have 1 member initially');
console.log(`  ✅ Room ${room.code} created successfully with Host Alice\n`);

// Test 2: Joining and Member Order (1, 2, 3...)
console.log('Test 2: Member Joining & Order Tracking');
const join2 = roomStore.joinRoom(room.code, 'user_2', 'sock_2', 'Bob', '#06b6d4');
assert.strictEqual(join2.member.orderIndex, 2, 'Second member should have orderIndex 2');

const join3 = roomStore.joinRoom(room.code, 'user_3', 'sock_3', 'Charlie', '#ec4899');
assert.strictEqual(join3.member.orderIndex, 3, 'Third member should have orderIndex 3');

const join4 = roomStore.joinRoom(room.code, 'user_4', 'sock_4', 'Diana', '#10b981');
assert.strictEqual(join4.member.orderIndex, 4, 'Fourth member should have orderIndex 4');
assert.strictEqual(room.members.size, 4, 'Room should now have 4 members');
console.log('  ✅ Members joined and assigned order 1, 2, 3, 4\n');

// Test 3: Capacity Limit (Max 10)
console.log('Test 3: Capacity Limit Enforcement (Max 10)');
for (let i = 5; i <= 10; i++) {
  roomStore.joinRoom(room.code, `user_${i}`, `sock_${i}`, `Member ${i}`, '#a855f7');
}
assert.strictEqual(room.members.size, 10, 'Room should now have exactly 10 members');

let fullErrorThrown = false;
try {
  roomStore.joinRoom(room.code, 'user_11', 'sock_11', 'Extra User', '#f59e0b');
} catch (err) {
  fullErrorThrown = true;
  assert.match(err.message, /full/i, 'Error message indicates room is full');
}
assert.ok(fullErrorThrown, '11th member must be rejected due to capacity limit');
console.log('  ✅ 10-member capacity limit strictly enforced\n');

// Clean up members 5-10 for queue test
for (let i = 5; i <= 10; i++) {
  roomStore.leaveRoom(room.code, `user_${i}`);
}
assert.strictEqual(room.members.size, 4, 'Room reset back to 4 members for queue testing');

// Test 4: Round-Robin Interleaved Queue (Member 1 -> 2 -> 3 -> 4 -> 1 -> 2...)
console.log('Test 4: Round-Robin Interleaved Queue Scheduling');
// Alice adds track A1 (starts immediately)
roomStore.addTrack(room.code, 'user_1', {
  id: 't_a1',
  source: 'youtube',
  mediaId: 'vid1',
  title: 'Track A1 (Alice)',
  duration: 180,
});
assert.strictEqual(room.currentTrack.id, 't_a1', 'First track plays immediately');

// Alice adds A2, A3
roomStore.addTrack(room.code, 'user_1', { id: 't_a2', title: 'Track A2 (Alice)' });
roomStore.addTrack(room.code, 'user_1', { id: 't_a3', title: 'Track A3 (Alice)' });

// Bob adds B1, B2
roomStore.addTrack(room.code, 'user_2', { id: 't_b1', title: 'Track B1 (Bob)' });
roomStore.addTrack(room.code, 'user_2', { id: 't_b2', title: 'Track B2 (Bob)' });

// Charlie adds C1
roomStore.addTrack(room.code, 'user_3', { id: 't_c1', title: 'Track C1 (Charlie)' });

// Diana adds D1, D2
roomStore.addTrack(room.code, 'user_4', { id: 't_d1', title: 'Track D1 (Diana)' });
roomStore.addTrack(room.code, 'user_4', { id: 't_d2', title: 'Track D2 (Diana)' });

// Check master queue interleaving
const interleaved = roomStore.getInterleavedQueue(room);
console.log('  Generated Master Interleaved Queue:');
interleaved.forEach((t, idx) => {
  console.log(`    #${idx + 1}: [Member ${t.memberOrder}] ${t.title}`);
});

// Since user_1 is playing, next turns must be:
// Round 1: Bob (B1) -> Charlie (C1) -> Diana (D1) -> Alice (A2)
// Round 2: Bob (B2) -> Diana (D2) -> Alice (A3)
assert.strictEqual(interleaved[0].id, 't_b1', '1st in queue should be Bob (Member 2)');
assert.strictEqual(interleaved[1].id, 't_c1', '2nd in queue should be Charlie (Member 3)');
assert.strictEqual(interleaved[2].id, 't_d1', '3rd in queue should be Diana (Member 4)');
assert.strictEqual(interleaved[3].id, 't_a2', '4th in queue should wrap to Alice (Member 1)');
assert.strictEqual(interleaved[4].id, 't_b2', '5th in queue should be Bob (Member 2)');
assert.strictEqual(interleaved[5].id, 't_d2', '6th in queue should be Diana (Member 4)');
assert.strictEqual(interleaved[6].id, 't_a3', '7th in queue should be Alice (Member 1)');
console.log('  ✅ Perfect turn-by-turn round-robin interleaving verified\n');

// Test 5: Democratic Skip Voting (>= 50% threshold)
console.log('Test 5: Skip Voting System');
assert.strictEqual(room.members.size, 4); // 50% of 4 = 2 votes needed
const vote1 = roomStore.voteSkip(room.code, 'user_2');
assert.strictEqual(vote1.skipped, false, '1 vote is not enough for 4 members');
assert.strictEqual(vote1.votes, 1);
assert.strictEqual(vote1.requiredVotes, 2);

const vote2 = roomStore.voteSkip(room.code, 'user_3');
assert.strictEqual(vote2.skipped, true, '2 votes (>= 50%) should trigger auto-skip');
assert.strictEqual(room.currentTrack.id, 't_b1', 'Now playing should advance to Bob\'s track (t_b1)');
console.log('  ✅ Auto-skip passed at 50% threshold and advanced to Bob\'s track\n');

// Test 6: Host Controls (Lock Room, Force Skip, Kick Member)
console.log('Test 6: Host Controls');
// Force Skip by Host
const forceRes = roomStore.forceSkip(room.code, 'user_1');
assert.strictEqual(room.currentTrack.id, 't_c1', 'Force skip advanced to Charlie\'s track (t_c1)');

// Toggle Lock
roomStore.toggleLock(room.code, 'user_1');
assert.strictEqual(room.isLocked, true, 'Room should now be locked');

let lockBlocked = false;
try {
  roomStore.joinRoom(room.code, 'user_locked_test', 's_lock', 'Blocked User', '#fff');
} catch (e) {
  lockBlocked = true;
  assert.match(e.message, /locked/i);
}
assert.ok(lockBlocked, 'Locked room blocks new joiners');

// Kick Member
roomStore.kickMember(room.code, 'user_1', 'user_4', 'Rule violation');
assert.strictEqual(room.members.has('user_4'), false, 'Diana removed by Host');
console.log('  ✅ Host force-skip, room lock, and member kick fully functional\n');

console.log('🎉 ALL UNIT & INTEGRATION TESTS PASSED 100%!\n');

