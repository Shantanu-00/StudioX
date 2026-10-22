'use strict';
const form = document.getElementById('form');
const input = document.getElementById('code');
const status = document.getElementById('status');

input.addEventListener('input', () => {
  const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  input.value = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'CHECKING…';
  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: input.value}),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Code not recognised');
    location.href = body.path;
  } catch (err) {
    status.textContent = String(err.message).toUpperCase();
    status.className = 'status alert';
  }
});
