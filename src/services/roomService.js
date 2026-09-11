const { db } = require('../config/database');

const roomService = {
  getAllRooms({ activeOnly = false } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM court_rooms WHERE is_active = 1 ORDER BY room_name ASC'
      : 'SELECT * FROM court_rooms ORDER BY id ASC';
    return db.prepare(sql).all();
  },

  getRoomById(id) {
    return db.prepare('SELECT * FROM court_rooms WHERE id = ?').get(id);
  },

  createRoom({ room_name, session_title, capacity = 50, is_active = 1 }) {
    const stmt = db.prepare(`
      INSERT INTO court_rooms (room_name, session_title, capacity, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(room_name.trim(), session_title.trim(), Number(capacity), Number(is_active));
    return this.getRoomById(Number(result.lastInsertRowid));
  },

  updateRoom(id, { room_name, session_title, capacity, is_active }) {
    db.prepare(`
      UPDATE court_rooms 
      SET room_name = ?, session_title = ?, capacity = ?, is_active = ?
      WHERE id = ?
    `).run(room_name.trim(), session_title.trim(), Number(capacity), Number(is_active), id);
    return this.getRoomById(id);
  },

  deleteRoom(id) {
    const result = db.prepare('DELETE FROM court_rooms WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * Get attendance and capacity statistics for a specific room
   */
  getRoomStats(id) {
    const room = this.getRoomById(id);
    if (!room) return null;

    const stats = db.prepare(`
      SELECT 
        COUNT(ra.id) as allocated_count,
        SUM(CASE WHEN ra.is_attended = 1 THEN 1 ELSE 0 END) as attended_count
      FROM room_allocations ra
      WHERE ra.room_id = ?
    `).get(id);

    const allocated = Number(stats?.allocated_count || 0);
    const attended = Number(stats?.attended_count || 0);
    const capacity = Number(room.capacity);
    const unattended = Math.max(0, allocated - attended);

    return {
      ...room,
      allocated,
      attended,
      unattended,
      remaining_capacity: Math.max(0, capacity - attended),
      attendance_percentage: capacity > 0 ? Math.round((attended / capacity) * 100) : 0
    };
  },

  /**
   * Get stats for all rooms + overall system stats
   */
  getSystemOverview() {
    const rooms = this.getAllRooms();
    const roomStats = rooms.map(r => this.getRoomStats(r.id));

    const totalParticipants = Number(db.prepare('SELECT COUNT(*) as c FROM participants').get()?.c || 0);
    const totalAllocated = Number(db.prepare('SELECT COUNT(DISTINCT participant_id) as c FROM room_allocations').get()?.c || 0);
    const totalAttended = Number(db.prepare('SELECT COUNT(*) as c FROM room_allocations WHERE is_attended = 1').get()?.c || 0);

    return {
      totalParticipants,
      totalAllocated,
      unallocated: Math.max(0, totalParticipants - totalAllocated),
      totalAttended,
      roomStats
    };
  }
};

module.exports = roomService;
