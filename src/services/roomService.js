const { db } = require('../config/database');

const roomService = {
  async getAllRooms({ activeOnly = false } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM court_rooms WHERE is_active = 1 ORDER BY room_name ASC'
      : 'SELECT * FROM court_rooms ORDER BY id ASC';
    return await db.all(sql);
  },

  async getRoomById(id) {
    return await db.get('SELECT * FROM court_rooms WHERE id = ?', [id]);
  },

  async createRoom({ room_name, session_title, capacity = 50, is_active = 1 }) {
    const res = await db.run(`
      INSERT INTO court_rooms (room_name, session_title, capacity, is_active)
      VALUES (?, ?, ?, ?)
    `, [room_name.trim(), session_title.trim(), Number(capacity), Number(is_active)]);
    return await this.getRoomById(Number(res.lastInsertRowid));
  },

  async updateRoom(id, { room_name, session_title, capacity, is_active }) {
    await db.run(`
      UPDATE court_rooms 
      SET room_name = ?, session_title = ?, capacity = ?, is_active = ?
      WHERE id = ?
    `, [room_name.trim(), session_title.trim(), Number(capacity), Number(is_active), id]);
    return await this.getRoomById(id);
  },

  async deleteRoom(id) {
    const result = await db.run('DELETE FROM court_rooms WHERE id = ?', [id]);
    return result.changes > 0;
  },

  /**
   * Get attendance and capacity statistics for a specific room
   */
  async getRoomStats(id) {
    const room = await this.getRoomById(id);
    if (!room) return null;

    const stats = await db.get(`
      SELECT 
        COUNT(ra.id) as allocated_count,
        SUM(CASE WHEN ra.is_attended = 1 THEN 1 ELSE 0 END) as attended_count,
        SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NULL THEN 1 ELSE 0 END) as inside_count,
        SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NOT NULL THEN 1 ELSE 0 END) as exited_count
      FROM room_allocations ra
      WHERE ra.room_id = ?
    `, [id]);

    const allocated = Number(stats?.allocated_count || 0);
    const attended = Number(stats?.attended_count || 0);
    const inside = Number(stats?.inside_count || 0);
    const exited = Number(stats?.exited_count || 0);
    const capacity = Number(room.capacity);
    const unattended = Math.max(0, allocated - attended);

    return {
      ...room,
      allocated,
      attended,
      inside,
      exited,
      unattended,
      remaining_capacity: Math.max(0, capacity - inside),
      attendance_percentage: capacity > 0 ? Math.round((attended / capacity) * 100) : 0
    };
  },

  /**
   * Get stats for all rooms + overall system stats
   */
  async getSystemOverview() {
    const rooms = await this.getAllRooms();
    const roomStats = await Promise.all(rooms.map(r => this.getRoomStats(r.id)));

    const countPart = await db.get('SELECT COUNT(*) as c FROM participants');
    const totalParticipants = Number(countPart?.c || 0);

    const countAlloc = await db.get('SELECT COUNT(DISTINCT participant_id) as c FROM room_allocations');
    const totalAllocated = Number(countAlloc?.c || 0);

    const countAtt = await db.get('SELECT COUNT(*) as c FROM room_allocations WHERE is_attended = 1');
    const totalAttended = Number(countAtt?.c || 0);

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
