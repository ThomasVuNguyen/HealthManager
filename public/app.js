/* ============================================
   healthmanager — app.js
   vanilla JS, no framework, no build step
   ============================================ */

(() => {
  'use strict';

  // ---- accent color rotation for person tags ----
  const ACCENTS = [
    'rgb(255,199,0)',   // yellow
    'rgb(0,255,26)',    // green
    'rgb(0,119,255)',   // blue
  ];

  // ---- state ----
  let currentUser = null;
  let people = [];
  let allFiles = [];
  let selectedPersonId = null;
  let authMode = 'login'; // 'login' or 'register'

  // ---- DOM refs ----
  const $authScreen = document.getElementById('authScreen');
  const $authForm = document.getElementById('authForm');
  const $authEmail = document.getElementById('authEmail');
  const $authPassword = document.getElementById('authPassword');
  const $authError = document.getElementById('authError');
  const $authSubmit = document.getElementById('authSubmit');
  const $loginTab = document.getElementById('loginTab');
  const $registerTab = document.getElementById('registerTab');

  const $appHeader = document.getElementById('appHeader');
  const $appMain = document.getElementById('appMain');
  const $userEmail = document.getElementById('userEmail');
  const $logoutBtn = document.getElementById('logoutBtn');

  const $chips = document.getElementById('personChips');
  const $uploadZone = document.getElementById('uploadZone');
  const $fileInput = document.getElementById('fileInput');
  const $fileGrid = document.getElementById('fileGrid');
  const $emptyState = document.getElementById('emptyState');
  const $addPersonBtn = document.getElementById('addPersonBtn');
  const $modalOverlay = document.getElementById('modalOverlay');
  const $personNameInput = document.getElementById('personNameInput');
  const $modalCancel = document.getElementById('modalCancel');
  const $modalAdd = document.getElementById('modalAdd');

  const $previewOverlay = document.getElementById('previewOverlay');
  const $previewFilename = document.getElementById('previewFilename');
  const $previewDownload = document.getElementById('previewDownload');
  const $previewClose = document.getElementById('previewClose');
  const $previewBody = document.getElementById('previewBody');

  // ---- helpers ----
  function accentForIndex(i) { return ACCENTS[i % ACCENTS.length]; }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' b';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kb';
    return (bytes / (1024 * 1024)).toFixed(1) + ' mb';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
  }

  function isImage(contentType) {
    return contentType && contentType.startsWith('image/');
  }

  function fileIcon(contentType) {
    if (!contentType) return '📄';
    if (contentType.startsWith('image/')) return '🖼️';
    if (contentType === 'application/pdf') return '📄';
    return '📄';
  }

  // ---- auth UI ----
  function showAuth() {
    $authScreen.style.display = '';
    $appHeader.style.display = 'none';
    $appMain.style.display = 'none';
  }

  function showApp() {
    $authScreen.style.display = 'none';
    $appHeader.style.display = '';
    $appMain.style.display = '';
    $userEmail.textContent = currentUser.email;
  }

  function setAuthMode(mode) {
    authMode = mode;
    $authSubmit.textContent = mode;
    $authError.textContent = '';
    if (mode === 'login') {
      $loginTab.classList.add('active');
      $registerTab.classList.remove('active');
    } else {
      $loginTab.classList.remove('active');
      $registerTab.classList.add('active');
    }
  }

  $loginTab.addEventListener('click', () => setAuthMode('login'));
  $registerTab.addEventListener('click', () => setAuthMode('register'));

  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $authError.textContent = '';
    $authSubmit.disabled = true;
    $authSubmit.textContent = '...';

    const email = $authEmail.value.trim();
    const password = $authPassword.value;

    try {
      const res = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        $authError.textContent = data.error || 'something went wrong.';
        return;
      }

      currentUser = data.user;
      showApp();
      await refresh();
    } catch (err) {
      $authError.textContent = 'network error. try again.';
    } finally {
      $authSubmit.disabled = false;
      $authSubmit.textContent = authMode;
    }
  });

  $logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    people = [];
    allFiles = [];
    selectedPersonId = null;
    showAuth();
  });

  // ---- API calls ----
  async function fetchPeople() {
    try {
      const res = await fetch('/api/people');
      if (res.status === 401) { showAuth(); return; }
      const data = await res.json();
      people = data.people || data || [];
    } catch (e) {
      console.error('fetch people failed:', e);
      people = [];
    }
  }

  async function fetchFilesForPerson(personId) {
    try {
      const res = await fetch(`/api/people/${personId}/files`);
      if (res.status === 401) { showAuth(); return []; }
      const data = await res.json();
      return data.files || data || [];
    } catch (e) {
      console.error('fetch files failed:', e);
      return [];
    }
  }

  async function fetchAllFiles() {
    const nested = await Promise.all(
      people.map(async (p) => {
        const files = await fetchFilesForPerson(p.id);
        return files.map(f => ({ ...f, person_id: f.person_id || p.id, _personName: p.name }));
      })
    );
    allFiles = nested.flat();
  }

  async function createPerson(name) {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async function deletePerson(id) {
    await fetch(`/api/people/${id}`, { method: 'DELETE' });
  }

  async function uploadFiles(personId, fileList) {
    for (const file of fileList) {
      const form = new FormData();
      form.append('file', file);
      await fetch(`/api/people/${personId}/files`, { method: 'POST', body: form });
    }
  }

  async function deleteFile(fileId) {
    await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
  }

  // ---- rendering ----
  function personName(personId) {
    const p = people.find(x => x.id === personId);
    return p ? p.name : '';
  }

  function personIndex(personId) {
    return people.findIndex(x => x.id === personId);
  }

  function renderChips() {
    $chips.innerHTML = '';

    const allChip = document.createElement('button');
    allChip.className = 'chip' + (selectedPersonId === null ? ' active' : '');
    allChip.textContent = 'all';
    allChip.addEventListener('click', () => { selectedPersonId = null; render(); });
    $chips.appendChild(allChip);

    people.forEach((p) => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (selectedPersonId === p.id ? ' active' : '');
      chip.textContent = p.name.toLowerCase();
      chip.addEventListener('click', () => { selectedPersonId = p.id; render(); });
      $chips.appendChild(chip);
    });
  }

  function renderUploadZone() {
    if (selectedPersonId) {
      $uploadZone.classList.add('visible');
    } else {
      $uploadZone.classList.remove('visible');
    }
  }

  function renderFiles() {
    const filtered = selectedPersonId
      ? allFiles.filter(f => f.person_id === selectedPersonId)
      : allFiles;

    $fileGrid.innerHTML = '';

    if (filtered.length === 0) {
      $fileGrid.style.display = 'none';
      $emptyState.style.display = 'block';
      if (people.length === 0) {
        $emptyState.textContent = 'no files yet. add someone and start uploading.';
      } else if (selectedPersonId) {
        $emptyState.textContent = 'no files for this person yet. drop some above.';
      } else {
        $emptyState.textContent = 'no files yet. select a person and start uploading.';
      }
      return;
    }

    $emptyState.style.display = 'none';
    $fileGrid.style.display = '';

    filtered.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'file-card';

      // thumbnail area
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (isImage(f.content_type)) {
        const img = document.createElement('img');
        img.src = `/api/files/${f.id}/download`;
        img.alt = f.filename;
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = fileIcon(f.content_type);
        thumb.appendChild(icon);
      }
      card.appendChild(thumb);

      // info
      const info = document.createElement('div');
      info.className = 'info';

      const fname = document.createElement('div');
      fname.className = 'filename';
      fname.textContent = f.filename.toLowerCase();
      info.appendChild(fname);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = formatSize(f.size) + ' · ' + formatDate(f.created_at);
      info.appendChild(meta);

      // person tag (visible only in "all" view)
      if (!selectedPersonId) {
        const pIdx = personIndex(f.person_id);
        const tag = document.createElement('span');
        tag.className = 'person-tag show';
        tag.style.backgroundColor = accentForIndex(pIdx >= 0 ? pIdx : 0);
        tag.textContent = (f._personName || personName(f.person_id)).toLowerCase();
        info.appendChild(tag);
      }

      card.appendChild(info);

      // delete button
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('delete this file?')) return;
        await deleteFile(f.id);
        await refresh();
      });
      card.appendChild(del);

      // click to preview
      card.addEventListener('click', () => {
        openPreview(f);
      });

      $fileGrid.appendChild(card);
    });
  }

  function render() {
    renderChips();
    renderUploadZone();
    renderFiles();
  }

  async function refresh() {
    await fetchPeople();
    await fetchAllFiles();
    render();
  }

  // ---- upload zone interactions ----
  $uploadZone.addEventListener('click', () => $fileInput.click());

  $uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    $uploadZone.classList.add('dragover');
  });
  $uploadZone.addEventListener('dragleave', () => {
    $uploadZone.classList.remove('dragover');
  });
  $uploadZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    $uploadZone.classList.remove('dragover');
    if (!selectedPersonId || !e.dataTransfer.files.length) return;
    await uploadFiles(selectedPersonId, e.dataTransfer.files);
    await refresh();
  });

  $fileInput.addEventListener('change', async () => {
    if (!selectedPersonId || !$fileInput.files.length) return;
    await uploadFiles(selectedPersonId, $fileInput.files);
    $fileInput.value = '';
    await refresh();
  });

  // ---- modal interactions ----
  function openModal() {
    $modalOverlay.classList.add('open');
    $personNameInput.value = '';
    setTimeout(() => $personNameInput.focus(), 50);
  }
  function closeModal() {
    $modalOverlay.classList.remove('open');
  }

  async function submitPerson() {
    const name = $personNameInput.value.trim();
    if (!name) return;
    closeModal();
    await createPerson(name);
    await refresh();
    // auto-select the new person
    const newest = people[people.length - 1];
    if (newest) { selectedPersonId = newest.id; render(); }
  }

  $addPersonBtn.addEventListener('click', openModal);
  $modalCancel.addEventListener('click', closeModal);
  $modalAdd.addEventListener('click', submitPerson);
  $personNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPerson();
  });
  $modalOverlay.addEventListener('click', (e) => {
    if (e.target === $modalOverlay) closeModal();
  });

  // ---- preview modal ----
  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    return lines.map(line => {
      const cols = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      cols.push(cur.trim());
      return cols;
    });
  }

  function isCSV(f) {
    return f.content_type === 'text/csv' ||
           f.filename.toLowerCase().endsWith('.csv');
  }
  function isPDF(f) {
    return f.content_type === 'application/pdf' ||
           f.filename.toLowerCase().endsWith('.pdf');
  }

  async function openPreview(f) {
    const url = `/api/files/${f.id}/download`;
    $previewFilename.textContent = f.filename.toLowerCase();
    $previewDownload.href = url + '?download=1';
    $previewBody.innerHTML = '';

    if (isImage(f.content_type)) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = f.filename;
      $previewBody.appendChild(img);

    } else if (isPDF(f)) {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      $previewBody.appendChild(iframe);

    } else if (isCSV(f)) {
      try {
        const res = await fetch(url);
        const text = await res.text();
        const rows = parseCSV(text);
        if (rows.length === 0) {
          $previewBody.textContent = 'empty csv file.';
        } else {
          const wrap = document.createElement('div');
          wrap.className = 'csv-wrap';
          const table = document.createElement('table');
          table.className = 'csv-table';
          // header
          const thead = document.createElement('thead');
          const hrow = document.createElement('tr');
          rows[0].forEach(cell => {
            const th = document.createElement('th');
            th.textContent = cell;
            hrow.appendChild(th);
          });
          thead.appendChild(hrow);
          table.appendChild(thead);
          // body (limit to 200 rows for performance)
          const tbody = document.createElement('tbody');
          rows.slice(1, 201).forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
              const td = document.createElement('td');
              td.textContent = cell;
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          wrap.appendChild(table);
          if (rows.length > 201) {
            const note = document.createElement('p');
            note.style.cssText = 'color:var(--text-secondary);font-size:0.8rem;margin-top:12px;text-transform:lowercase;';
            note.textContent = `showing 200 of ${rows.length - 1} rows. download for full data.`;
            wrap.appendChild(note);
          }
          $previewBody.appendChild(wrap);
        }
      } catch {
        $previewBody.textContent = 'failed to load csv.';
      }

    } else {
      // Unsupported type — just offer download
      $previewBody.innerHTML = '<p style="color:var(--text-secondary);text-transform:lowercase;">preview not available for this file type. use download.</p>';
    }

    $previewOverlay.classList.add('open');
  }

  function closePreview() {
    $previewOverlay.classList.remove('open');
    $previewBody.innerHTML = '';
  }

  $previewClose.addEventListener('click', closePreview);
  $previewOverlay.addEventListener('click', (e) => {
    if (e.target === $previewOverlay) closePreview();
  });

  // ---- init: check if already logged in ----
  async function init() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        showApp();
        await refresh();
        return;
      }
    } catch (e) {}
    showAuth();
  }

  init();
})();
