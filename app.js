const form = document.getElementById('loginForm');
const message = document.getElementById('message');

const isServedByHttp = window.location.protocol.startsWith('http');
if (!isServedByHttp) {
  message.textContent = 'Энэ хуудсыг файлаар нээх биш серверээр нээж, http://localhost:8088 хаягаар орно уу.';
  message.classList.add('error');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  message.className = 'message';

  const formData = new FormData(form);
  const payload = {
    username: formData.get('username').trim(),
    password: formData.get('password').trim(),
  };

  try {
    const response = await fetch('/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const txt = await response.text();
      // If server returned plain text (e.g., an error), show it
      throw new Error(txt || `HTTP ${response.status}`);
    }

    if (response.ok && result.success) {
      // Verify session is recognized by server before navigating to main
      try {
        const profileCheck = await fetch('/api/profile', { credentials: 'include' });
        if (profileCheck.ok) {
          window.location.href = '/main.html';
          return;
        }
        // fallthrough to show error
      } catch (err) {
        // fallthrough to show error
      }

      message.textContent = 'Нэвтрэлт амжилттай боловч сесс хадгалагдаагүй. Хуудас руу шилжүүлж чадсангүй.';
      message.classList.add('error');
      return;
    } else {
      message.textContent = result.message || 'Нэвтрэхэд алдаа гарлаа.';
      message.classList.add('error');
    }
  } catch (error) {
    message.textContent = `Сервертэй холбогдож чадсангүй: ${error?.message || 'тодорхойгүй алдаа'}`;
    message.classList.add('error');
  }
});

// Microsoft login removed
