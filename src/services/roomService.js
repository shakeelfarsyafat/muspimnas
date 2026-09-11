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
   * Get attendance and capacity statistics for a specific room (Optimized single query)
   */
  async getRoomStats(id) {
    const roomWithStats = await db.get(`
      SELECT 
        cr.*,
        COUNT(ra.id) as allocated_count,
        SUM(CASE WHEN ra.is_attended = 1 THEN 1 ELSE 0 END) as attended_count,
        SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NULL THEN 1 ELSE 0 END) as inside_count,
        SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NOT NULL THEN 1 ELSE 0 END) as exited_count
      FROM court_rooms cr
      LEFT JOIN room_allocations ra ON ra.room_id = cr.id
      WHERE cr.id = ?
      GROUP BY cr.id
    `, [id]);

    if (!roomWithStats) return null;

    const allocated = Number(roomWithStats.allocated_count || 0);
    const attended = Number(roomWithStats.attended_count || 0);
    const inside = Number(roomWithStats.inside_count || 0);
    const exited = Number(roomWithStats.exited_count || 0);
    const capacity = Number(roomWithStats.capacity || 0);
    const unattended = Math.max(0, allocated - attended);

    return {
      id: roomWithStats.id,
      room_name: roomWithStats.room_name,
      session_title: roomWithStats.session_title,
      capacity,
      is_active: roomWithStats.is_active,
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
   * Get stats for all rooms + overall system stats (Optimized batch queries)
   */
  async getSystemOverview() {
    const [allRoomStats, countPart, countAlloc, countAtt] = await Promise.all([
      db.all(`
        SELECT 
          cr.*,
          COUNT(ra.id) as allocated_count,
          SUM(CASE WHEN ra.is_attended = 1 THEN 1 ELSE 0 END) as attended_count,
          SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NULL THEN 1 ELSE 0 END) as inside_count,
          SUM(CASE WHEN ra.is_attended = 1 AND ra.left_at IS NOT NULL THEN 1 ELSE 0 END) as exited_count
        FROM court_rooms cr
        LEFT JOIN room_allocations ra ON ra.room_id = cr.id
        GROUP BY cr.id
        ORDER BY cr.id ASC
      `),
      db.get('SELECT COUNT(*) as c FROM participants'),
      db.get('SELECT COUNT(DISTINCT participant_id) as c FROM room_allocations'),
      db.get('SELECT COUNT(*) as c FROM room_allocations WHERE is_attended = 1')
    ]);

    const roomStats = allRoomStats.map(r => {
      const allocated = Number(r.allocated_count || 0);
      const attended = Number(r.attended_count || 0);
      const inside = Number(r.inside_count || 0);
      const exited = Number(r.exited_count || 0);
      const capacity = Number(r.capacity || 0);
      return {
        id: r.id,
        room_name: r.room_name,
        session_title: r.session_title,
        capacity,
        is_active: r.is_active,
        allocated,
        attended,
        inside,
        exited,
        unattended: Math.max(0, allocated - attended),
        remaining_capacity: Math.max(0, capacity - inside),
        attendance_percentage: capacity > 0 ? Math.round((attended / capacity) * 100) : 0
      };
    });

    const totalParticipants = Number(countPart?.c || 0);
    const totalAllocated = Number(countAlloc?.c || 0);
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
