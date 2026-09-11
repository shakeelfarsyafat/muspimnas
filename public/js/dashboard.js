/**
 * Dashboard & Bulk Assignment Handler
 */

document.addEventListener('DOMContentLoaded', () => {
  const selectAllCheckbox = document.getElementById('select-all-participants');
  const rowCheckboxes = document.querySelectorAll('.participant-checkbox');
  const floatingToolbar = document.getElementById('floating-bulk-toolbar');
  const selectedCountSpan = document.getElementById('selected-count');
  const bulkPrintBtn = document.getElementById('btn-bulk-print');
  const bulkAssignBtn = document.getElementById('btn-bulk-assign');
  const bulkRoomSelect = document.getElementById('bulk-room-select');

  // Participant Form Elements
  const participantModal = document.getElementById('participant-modal');
  const participantForm = document.getElementById('participant-form');
  const modalTitle = document.getElementById('modal-title');
  const inputParticipantId = document.getElementById('p-id');
  const inputName = document.getElementById('p-name');
  const inputIdentifier = document.getElementById('p-identifier');
  const inputInstitution = document.getElementById('p-institution');
  const inputRoom = document.getElementById('p-room');

  function updateBulkToolbar() {
    const checkedBoxes = document.querySelectorAll('.participant-checkbox:checked');
    const count = checkedBoxes.length;

    if (selectedCountSpan) {
      selectedCountSpan.textContent = count;
    }

    if (count > 0) {
      floatingToolbar?.classList.add('active');
    } else {
      floatingToolbar?.classList.remove('active');
    }

    if (selectAllCheckbox) {
      const allCheckboxes = document.querySelectorAll('.participant-checkbox');
      selectAllCheckbox.checked = (allCheckboxes.length > 0 && checkedBoxes.length === allCheckboxes.length);
      selectAllCheckbox.indeterminate = (count > 0 && count < allCheckboxes.length);
    }
  }

  // Select All Toggle
  selectAllCheckbox?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    rowCheckboxes.forEach(cb => {
      cb.checked = isChecked;
    });
    updateBulkToolbar();
  });

  // Individual Checkbox Change
  rowCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      updateBulkToolbar();
    });
  });

  // Bulk Print Action
  bulkPrintBtn?.addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.participant-checkbox:checked'))
      .map(cb => cb.value);

    if (checked.length === 0) {
      showToast('Pilih minimal satu peserta untuk dicetak.', 'error');
      return;
    }

    const printUrl = `/print?ids=${checked.join(',')}`;
    window.open(printUrl, '_blank');
  });

  // Bulk Assign Action
  bulkAssignBtn?.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.participant-checkbox:checked'))
      .map(cb => Number(cb.value));

    const roomId = bulkRoomSelect?.value;

    if (checked.length === 0) {
      showToast('Pilih minimal satu peserta.', 'error');
      return;
    }

    if (!roomId) {
      showToast('Pilih ruangan sidang tujuan terlebih dahulu!', 'warning');
      bulkRoomSelect?.focus();
      return;
    }

    bulkAssignBtn.disabled = true;
    bulkAssignBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Memproses...';

    try {
      const res = await fetch('/api/participants/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_ids: checked, room_id: Number(roomId) })
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        setTimeout(() => {
          window.location.reload();
        }, 800);
      } else {
        showToast(data.message || 'Gagal menugaskan peserta.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan jaringan.', 'error');
    } finally {
      bulkAssignBtn.disabled = false;
      bulkAssignBtn.innerHTML = '<i class="fas fa-check-double mr-1"></i> Tugaskan ke Ruangan';
    }
  });

  // Open Add Participant Modal
  window.openAddParticipantModal = function() {
    if (!participantForm) return;
    participantForm.reset();
    inputParticipantId.value = '';
    modalTitle.textContent = 'Tambah Peserta Sidang Baru';
    participantModal.classList.remove('hidden');
    participantModal.classList.add('flex');
    inputName.focus();
  };

  // Open Edit Participant Modal
  window.openEditParticipantModal = async function(id) {
    try {
      const res = await fetch(`/api/participants/${id}`);
      const data = await res.json();
      if (data.success && data.participant) {
        const p = data.participant;
        inputParticipantId.value = p.id;
        inputName.value = p.name;
        inputIdentifier.value = p.identifier_num;
        inputInstitution.value = p.institution || '';
        inputRoom.value = p.room_id || '';

        modalTitle.textContent = 'Edit Data Peserta';
        participantModal.classList.remove('hidden');
        participantModal.classList.add('flex');
      } else {
        showToast(data.message || 'Gagal mengambil data peserta.', 'error');
      }
    } catch (err) {
      showToast('Gagal memuat data peserta.', 'error');
    }
  };

  window.closeParticipantModal = function() {
    participantModal.classList.add('hidden');
    participantModal.classList.remove('flex');
  };

  // Participant Form Submit (Add or Edit)
  participantForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = inputParticipantId.value;
    const isEdit = Boolean(id);
    const url = isEdit ? `/api/participants/${id}` : '/api/participants';
    const method = isEdit ? 'PUT' : 'POST';

    const payload = {
      name: inputName.value.trim(),
      identifier_num: inputIdentifier.value.trim(),
      institution: inputInstitution.value.trim(),
      room_id: inputRoom.value || null
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        showToast(data.message, 'success');
        closeParticipantModal();
        setTimeout(() => {
          window.location.reload();
        }, 700);
      } else {
        showToast(data.message || 'Terjadi kesalahan.', 'error');
      }
    } catch (err) {
      showToast('Kesalahan saat menyimpan data.', 'error');
    }
  });

  // Delete Participant
  window.deleteParticipant = async function(id, name) {
    if (!confirm(`Apakah Anda yakin ingin menghapus peserta "${name}"? Data kehadiran dan alokasi ruangan akan terhapus permanen.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/participants/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        setTimeout(() => {
          window.location.reload();
        }, 700);
      } else {
        showToast(data.message || 'Gagal menghapus.', 'error');
      }
    } catch (err) {
      showToast('Kesalahan saat menghapus peserta.', 'error');
    }
  };

  // Reset Attendance
  window.resetAttendance = async function(id, name) {
    if (!confirm(`Reset status kehadiran untuk "${name}"? Peserta dapat dipindai ulang.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/participants/${id}/reset-attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        setTimeout(() => {
          window.location.reload();
        }, 700);
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Gagal reset absensi.', 'error');
    }
  };

  // ==========================================
  // Excel Import Modal Logic
  // ==========================================
  const importModal = document.getElementById('import-modal');
  const importForm = document.getElementById('import-form');
  const importFileInput = document.getElementById('import-file-input');
  const importFileLabel = document.getElementById('import-file-label');
  const importResultBox = document.getElementById('import-result-box');
  const btnSubmitImport = document.getElementById('btn-submit-import');

  window.openImportModal = function() {
    if (importForm) importForm.reset();
    if (importFileLabel) importFileLabel.innerHTML = 'Klik atau Tarik file Excel ke sini';
    if (importResultBox) {
      importResultBox.className = 'hidden p-3.5 rounded-xl text-xs font-medium';
      importResultBox.innerHTML = '';
    }
    if (btnSubmitImport) {
      btnSubmitImport.disabled = false;
      btnSubmitImport.innerHTML = '<i class="fas fa-upload text-xs mr-1"></i> <span>Mulai Impor Peserta</span>';
    }
    importModal?.classList.remove('hidden');
  };

  window.closeImportModal = function() {
    importModal?.classList.add('hidden');
  };

  // Update file input label on select
  importFileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && importFileLabel) {
      importFileLabel.innerHTML = `<span class="text-emerald-700 font-bold"><i class="fas fa-file-excel mr-1"></i> ${escapeHtml(file.name)}</span> (${(file.size / 1024).toFixed(1)} KB)`;
    }
  });

  // Submit Import Form
  importForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const file = importFileInput?.files[0];
    if (!file) {
      showToast('Pilih file Excel terlebih dahulu.', 'warning');
      return;
    }

    const formData = new FormData(importForm);

    btnSubmitImport.disabled = true;
    btnSubmitImport.innerHTML = '<i class="fas fa-spinner fa-spin text-xs mr-1"></i> <span>Mengimpor Data...</span>';

    try {
      const res = await fetch('/api/participants/import-excel', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        importResultBox.className = 'p-3.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 block';
        importResultBox.innerHTML = `
          <div class="font-bold flex items-center mb-1">
            <i class="fas fa-check-circle mr-1.5 text-emerald-600"></i> ${escapeHtml(data.message)}
          </div>
          <div class="text-[11px] text-emerald-700">
            Total Baris: <b>${data.result.total}</b> &bull; Berhasil: <b>${data.result.imported}</b> &bull; Dilewati/Sudah Ada: <b>${data.result.skipped}</b>
          </div>
        `;
        showToast(`Sukses mengimpor ${data.result.imported} peserta!`, 'success');

        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        importResultBox.className = 'p-3.5 rounded-xl text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200 block';
        importResultBox.innerHTML = `
          <div class="font-bold flex items-center mb-1">
            <i class="fas fa-exclamation-circle mr-1.5 text-rose-600"></i> Gagal Impor
          </div>
          <div class="text-[11px] text-rose-700">${escapeHtml(data.message || 'Terjadi kesalahan.')}</div>
        `;
        btnSubmitImport.disabled = false;
        btnSubmitImport.innerHTML = '<i class="fas fa-upload text-xs mr-1"></i> <span>Coba Lagi</span>';
      }
    } catch (err) {
      console.error('Import submit error:', err);
      showToast('Terjadi kesalahan koneksi saat mengunggah file.', 'error');
      btnSubmitImport.disabled = false;
      btnSubmitImport.innerHTML = '<i class="fas fa-upload text-xs mr-1"></i> <span>Mulai Impor Peserta</span>';
    }
  });

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
