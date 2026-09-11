/**
 * Compact Monitor Display & Live Sync Terminal Engine
 * Powered by Server-Sent Events (SSE) for Realtime Multi-Device Sync
 */

document.addEventListener('DOMContentLoaded', () => {
  const roomSelect = document.getElementById('scanner-room-select');
  const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
  const terminalContainer = document.getElementById('scanner-terminal-container');
  const sseStatusBadge = document.getElementById('sse-status-badge');

  const hardwareInput = document.getElementById('hardware-scanner-input');
  const manualScanForm = document.getElementById('manual-scan-form');

  const scanResultCard = document.getElementById('scan-result-card');
  const liveScansTableBody = document.getElementById('live-scans-table-body');
  const roomAttendedCount = document.getElementById('stat-room-attended');
  const roomUnattendedCount = document.getElementById('stat-room-unattended');

  const selectedRoomId = roomSelect?.value;

  // Fullscreen Kiosk Mode Toggle (Icon Only)
  btnToggleFullscreen?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (terminalContainer?.requestFullscreen) {
        terminalContainer.requestFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      }
      terminalContainer?.classList.add('kiosk-fullscreen');
      btnToggleFullscreen.innerHTML = '<i class="fas fa-compress"></i>';
      btnToggleFullscreen.title = 'Keluar Layar Penuh (F11)';
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      terminalContainer?.classList.remove('kiosk-fullscreen');
      btnToggleFullscreen.innerHTML = '<i class="fas fa-expand"></i>';
      btnToggleFullscreen.title = 'Layar Penuh (F11)';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      terminalContainer?.classList.remove('kiosk-fullscreen');
      if (btnToggleFullscreen) {
        btnToggleFullscreen.innerHTML = '<i class="fas fa-expand"></i>';
        btnToggleFullscreen.title = 'Layar Penuh (F11)';
      }
    }
  });

  // Room Select Change
  roomSelect?.addEventListener('change', (e) => {
    const roomId = e.target.value;
    if (roomId) {
      window.location.href = `/scanner?room_id=${roomId}`;
    }
  });

  // Hardware Scanner Form Submit from this display terminal
  manualScanForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = hardwareInput?.value.trim();
    if (token) {
      hardwareInput.value = '';
      try {
        await fetch('/api/verify/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr_token: token, room_id: Number(selectedRoomId) })
        });
        // Result will automatically be received via SSE!
      } catch (err) {
        console.error('Scan error:', err);
      }
    }
  });

  // Keep auto-focus on hardware scanner input
  function keepHardwareFocus() {
    if (hardwareInput && document.activeElement !== hardwareInput && document.activeElement !== roomSelect) {
      hardwareInput.focus();
    }
  }
  keepHardwareFocus();
  setInterval(keepHardwareFocus, 2500);

  /**
   * Realtime Multi-Device Sync via Server-Sent Events (SSE)
   */
  let eventSource = null;

  function connectSSE() {
    if (!selectedRoomId) return;

    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/verify/live-events/${selectedRoomId}`);

    eventSource.onopen = () => {
      if (sseStatusBadge) {
        sseStatusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1"></span> Live';
        sseStatusBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-800 tracking-wider flex items-center';
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'CONNECTED') return;

        handleIncomingScanEvent(data);
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      if (sseStatusBadge) {
        sseStatusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1"></span> Reconnecting';
        sseStatusBadge.className = 'px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-100 text-amber-800 tracking-wider flex items-center';
      }
    };
  }

  connectSSE();

  /**
   * Handle incoming scan event pushed from server
   */
  function handleIncomingScanEvent(data) {
    // 1. Audio feedback on monitor's speakers
    if (window.scannerAudio) {
      if (data.status === 'SUCCESS' || data.status === 'SUCCESS_OUT' || data.status === 'SUCCESS_REENTRY') {
        window.scannerAudio.playSuccess();
      } else if (data.status === 'ALREADY_ATTENDED' || data.status === 'ALREADY_LEFT') {
        window.scannerAudio.playWarning();
      } else {
        window.scannerAudio.playError();
      }
    }

    // 2. Render Compact Center Stage
    renderScanResult(data);

    // 3. Update room metrics
    if (data.roomStats) {
      const insideCount = data.roomStats.inside !== undefined ? data.roomStats.inside : data.roomStats.attended;
      const exitedCount = data.roomStats.exited !== undefined ? data.roomStats.exited : 0;
      const unattendedCount = data.roomStats.unattended !== undefined ? data.roomStats.unattended : Math.max(0, data.roomStats.allocated - data.roomStats.attended);

      if (roomAttendedCount) roomAttendedCount.textContent = insideCount;
      const roomExitedElem = document.getElementById('stat-room-exited');
      if (roomExitedElem) roomExitedElem.textContent = exitedCount;
      if (roomUnattendedCount) roomUnattendedCount.textContent = unattendedCount;
    }

    // 4. Prepend row to Database Table if SUCCESS or SUCCESS_OUT or SUCCESS_REENTRY
    if ((data.status === 'SUCCESS' || data.status === 'SUCCESS_OUT' || data.status === 'SUCCESS_REENTRY') && data.participant) {
      prependLiveTableRow(data.participant, data.status === 'SUCCESS_OUT' ? 'KELUAR' : 'MASUK');
    }
  }

  /**
   * Render Compact & High-Impact Verification Result
   */
  function renderScanResult(data) {
    if (!scanResultCard) return;

    if (data.status === 'SUCCESS' || data.status === 'SUCCESS_REENTRY') {
      const p = data.participant;
      const isReentry = data.status === 'SUCCESS_REENTRY';
      scanResultCard.className = 'glass-panel rounded-xl px-5 py-3 border-2 border-emerald-500 bg-emerald-50/70 shadow-lg pulse-success transition-all duration-300';
      scanResultCard.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-xl shadow-md flex-shrink-0">
              <i class="fas fa-check"></i>
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white uppercase tracking-wider">
                  ${isReentry ? 'MASUK KEMBALI' : 'AKSES MASUK DITERIMA'}
                </span>
                <span class="text-xs font-mono font-bold text-slate-500">${escapeHtml(p.identifier_num)}</span>
              </div>
              <h2 class="text-lg font-black text-slate-900 leading-tight mt-0.5">${escapeHtml(p.name)}</h2>
              <div class="text-[11px] text-slate-600 font-medium">${escapeHtml(p.institution || '-')} &bull; <span class="text-emerald-800 font-semibold">${escapeHtml(p.room_name)}</span></div>
            </div>
          </div>

          <div class="text-right">
            <span class="inline-block px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-mono font-bold text-xs">
              <i class="fas fa-clock mr-1 text-[10px]"></i> ${p.attended_at ? p.attended_at.slice(11, 19) : 'Baru Saja'}
            </span>
          </div>
        </div>
      `;
    } else if (data.status === 'SUCCESS_OUT') {
      const p = data.participant;
      scanResultCard.className = 'glass-panel rounded-xl px-5 py-3 border-2 border-amber-500 bg-amber-50/80 shadow-lg pulse-success transition-all duration-300';
      scanResultCard.innerHTML = `
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center text-xl shadow-md flex-shrink-0">
              <i class="fas fa-sign-out-alt"></i>
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-600 text-white uppercase tracking-wider">
                  PRESENSI KELUAR BERHASIL
                </span>
                <span class="text-xs font-mono font-bold text-slate-500">${escapeHtml(p.identifier_num)}</span>
              </div>
              <h2 class="text-lg font-black text-slate-900 leading-tight mt-0.5">${escapeHtml(p.name)}</h2>
              <div class="text-[11px] text-slate-600 font-medium">${escapeHtml(p.institution || '-')} &bull; <span class="text-amber-800 font-semibold">${escapeHtml(p.room_name)}</span></div>
            </div>
          </div>

          <div class="text-right">
            <span class="inline-block px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-mono font-bold text-xs">
              <i class="fas fa-clock mr-1 text-[10px]"></i> Keluar: ${p.left_at ? p.left_at.slice(11, 19) : 'Baru Saja'}
            </span>
          </div>
        </div>
      `;
    } else if (data.status === 'WRONG_ROOM') {
      const p = data.participant;
      scanResultCard.className = 'glass-panel rounded-xl px-5 py-3 border-2 border-rose-500 bg-rose-50/80 shadow-lg shake-error transition-all duration-300';
      scanResultCard.innerHTML = `
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xl shadow-md flex-shrink-0">
            <i class="fas fa-door-closed"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2">
              <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white uppercase tracking-wider">
                SALAH RUANG SIDANG
              </span>
              <span class="text-xs font-mono font-bold text-slate-500">${escapeHtml(p ? p.identifier_num : '')}</span>
            </div>
            <h2 class="text-base font-black text-rose-950 truncate mt-0.5">${escapeHtml(p ? p.name : 'Peserta')}</h2>
            <div class="text-xs font-extrabold text-indigo-900 mt-0.5 bg-white/80 px-2 py-0.5 rounded border border-rose-200 inline-block">
              <i class="fas fa-arrow-right mr-1 text-indigo-600"></i> Arahkan ke: <u>${escapeHtml(p ? p.correct_room : 'Ruangan Lain')}</u>
            </div>
          </div>
        </div>
      `;
    } else if (data.status === 'ALREADY_ATTENDED') {
      const p = data.participant;
      scanResultCard.className = 'glass-panel rounded-xl px-5 py-3 border-2 border-amber-500 bg-amber-50/80 shadow-lg transition-all duration-300';
      scanResultCard.innerHTML = `
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-xl shadow-md flex-shrink-0">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <div class="flex-1 min-w-0">
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-600 text-white uppercase tracking-wider">
              SUDAH MASUK SEBELUMNYA (ANTI-DOBEL)
            </span>
            <h2 class="text-base font-black text-amber-950 truncate mt-0.5">${escapeHtml(p ? p.name : 'Peserta')}</h2>
            <p class="text-xs font-bold text-amber-800">${escapeHtml(data.message)}</p>
          </div>
        </div>
      `;
    } else {
      scanResultCard.className = 'glass-panel rounded-xl px-5 py-3 border-2 border-rose-500 bg-rose-50/80 shadow-lg shake-error transition-all duration-300';
      scanResultCard.innerHTML = `
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center text-xl shadow-md flex-shrink-0">
            <i class="fas fa-times"></i>
          </div>
          <div>
            <span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white uppercase tracking-wider">
              AKSES DITOLAK
            </span>
            <h2 class="text-base font-black text-rose-950 mt-0.5">QR Code Tidak Terdaftar</h2>
            <p class="text-xs text-rose-700">${escapeHtml(data.message || 'QR Code tidak cocok dengan data peserta manapun.')}</p>
          </div>
        </div>
      `;
    }
  }

  /**
   * Prepend New Scan Row into Live Database Table
   */
  function prependLiveTableRow(p, action = 'MASUK') {
    if (!liveScansTableBody || !p) return;

    const emptyRow = document.getElementById('empty-history-row');
    if (emptyRow) emptyRow.remove();

    const isExit = action === 'KELUAR';
    const rawTime = isExit ? (p.left_at || p.attended_at) : (p.attended_at || p.left_at);
    const timeStr = rawTime 
      ? (rawTime.includes(' ') ? rawTime.split(' ')[1] : rawTime)
      : new Date().toLocaleTimeString('id-ID');

    const row = document.createElement('tr');
    row.className = 'table-row-new hover:bg-slate-50/90 transition text-xs';
    row.innerHTML = `
      <td class="py-2 px-3 text-center font-mono ${isExit ? 'text-amber-600' : 'text-emerald-600'} font-bold text-[11px]">1</td>
      <td class="py-2 px-3 font-mono font-bold text-slate-800 text-[11px]">
        <i class="fas fa-clock ${isExit ? 'text-amber-500' : 'text-emerald-500'} mr-1 text-[9px]"></i> ${timeStr}
      </td>
      <td class="py-2 px-3 font-bold text-slate-900">${escapeHtml(p.name)}</td>
      <td class="py-2 px-3 font-mono text-slate-600 text-[11px]">${escapeHtml(p.identifier_num)}</td>
      <td class="py-2 px-3 text-slate-600">${escapeHtml(p.institution || '-')}</td>
      <td class="py-2 px-3 text-center">
        ${isExit ? `
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800">
            <i class="fas fa-sign-out-alt mr-1 text-[8px]"></i> Keluar
          </span>
        ` : `
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">
            <i class="fas fa-check mr-1 text-[8px]"></i> Di Dalam
          </span>
        `}
      </td>
    `;

    liveScansTableBody.insertBefore(row, liveScansTableBody.firstChild);

    // Re-index row numbers
    const rows = liveScansTableBody.querySelectorAll('tr');
    rows.forEach((r, idx) => {
      const firstCell = r.querySelector('td:first-child');
      if (firstCell) {
        firstCell.textContent = idx + 1;
        if (idx !== 0) firstCell.className = 'py-2 px-3 text-center font-mono text-slate-400 font-semibold text-[11px]';
      }
    });

    while (liveScansTableBody.children.length > 30) {
      liveScansTableBody.removeChild(liveScansTableBody.lastChild);
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
