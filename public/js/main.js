const cursor = document.querySelector('#cursor');
const dot = document.querySelector('#cursor-dot');

if(cursor && dot) {
    document.addEventListener('mousemove', (e) => {
        cursor.style.left = e.clientX - 10 + 'px';
        cursor.style.top = e.clientY - 10 + 'px';
        dot.style.left = e.clientX - 2 + 'px';
        dot.style.top = e.clientY - 2 + 'px';
    });

    document.addEventListener('mousedown', () => {
        cursor.style.transform = 'scale(0.8)';
        cursor.style.background = 'rgba(0, 242, 255, 0.1)';
    });

    document.addEventListener('mouseup', () => {
        cursor.style.transform = 'scale(1)';
        cursor.style.background = 'transparent';
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
