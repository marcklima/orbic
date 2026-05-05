// Efeito de Cursor Tecnológico
const cursor = document.getElementById('cursor');
const cursorDot = document.getElementById('cursor-dot');

if (cursor && cursorDot) {
    window.addEventListener('mousemove', (e) => {
        cursor.style.transform = `translate(${e.clientX - 15}px, ${e.clientY - 15}px)`;
        cursorDot.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 3}px)`;
    });
}
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active');
    });
}, { threshold: 0.1 });

document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));

// Slider Logic (run only if slider exists)
const slides = document.querySelectorAll('.slide');
if (slides.length > 0) {
    let currentSlide = 0;
    function nextSlide() {
        slides[currentSlide].classList.remove('active');
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');
    }
    setInterval(nextSlide, 5000);
}


// Theme Toggle Logic
const themeToggles = document.querySelectorAll('#theme-toggle, #theme-toggle-logged');
const currentTheme = localStorage.getItem('orbic_theme');

if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeToggles.forEach(btn => btn.innerHTML = '🌙');
}

themeToggles.forEach(btn => {
    btn.addEventListener('click', () => {
        let theme = document.documentElement.getAttribute('data-theme');
        if (theme === 'light') {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('orbic_theme', 'dark');
            themeToggles.forEach(b => b.innerHTML = '☀️');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('orbic_theme', 'light');
            themeToggles.forEach(b => b.innerHTML = '🌙');
        }
    });
});
