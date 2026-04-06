// Cursor Animation
document.addEventListener('DOMContentLoaded', () => {
    const cursorDot = document.querySelector('.cursor-dot');
    const cursorOutline = document.querySelector('.cursor-outline');
    const backgroundGradient = document.querySelector('.background-gradient');

    // Mouse movement handler
    const handleMouseMove = (e) => {
        const posX = e.clientX;
        const posY = e.clientY;

        // Animate cursor dot
        gsap.to(cursorDot, {
            x: posX,
            y: posY,
            duration: 0.1,
            ease: 'power2.out'
        });

        // Animate cursor outline with slight delay
        gsap.to(cursorOutline, {
            x: posX,
            y: posY,
            duration: 0.15,
            ease: 'power2.out'
        });

        // Update background gradient position
        document.documentElement.style.setProperty('--mouse-x', `${posX}px`);
        document.documentElement.style.setProperty('--mouse-y', `${posY}px`);
    };

    // Add cursor animations
    document.addEventListener('mousemove', handleMouseMove);

    // Handle cursor states for interactive elements
    const handleCursorState = (elements, state) => {
        elements.forEach(el => {
            el.addEventListener(`mouse${state}`, () => {
                cursorDot.classList[state === 'enter' ? 'add' : 'remove']('active');
                cursorOutline.classList[state === 'enter' ? 'add' : 'remove']('active');
            });
        });
    };

    // Add cursor interactions for buttons and links
    const interactiveElements = document.querySelectorAll('button, a, input, textarea, .interactive');
    handleCursorState(interactiveElements, 'enter');
    handleCursorState(interactiveElements, 'leave');

    // Smooth scroll animation
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                gsap.to(window, {
                    duration: 1,
                    scrollTo: {
                        y: target,
                        offsetY: 70
                    },
                    ease: 'power2.inOut'
                });
            }
        });
    });

    // Intersection Observer for fade-in animations
    const fadeElements = document.querySelectorAll('.fade-in');
    fadeElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        el.style.opacity = '1';
                        el.style.transform = 'translateY(0)';
                    }, 100);
                    observer.unobserve(el);
                }
            });
        });
        
        observer.observe(el);
    });

    // Card hover effects
    document.querySelectorAll('.glass-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const deltaX = (x - centerX) / centerX;
            const deltaY = (y - centerY) / centerY;
            
            gsap.to(card, {
                duration: 0.5,
                rotateY: deltaX * 5,
                rotateX: -deltaY * 5,
                scale: 1.02,
                ease: 'power2.out'
            });
        });

        card.addEventListener('mouseleave', () => {
            gsap.to(card, {
                duration: 0.5,
                rotateY: 0,
                rotateX: 0,
                scale: 1,
                ease: 'power2.out'
            });
        });
    });

    // Simple hover effects for buttons
    document.querySelectorAll('.btn-modern').forEach(button => {
        button.addEventListener('mouseenter', () => {
            button.style.transform = 'translateY(-2px)';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
        });
    });

    // Simple loading animation
    const createLoadingAnimation = () => {
        const loading = document.createElement('div');
        loading.className = 'loading-dots';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            loading.appendChild(dot);
        }
        return loading;
    };

    // Add loading animation to buttons when clicked
    document.querySelectorAll('.btn-modern').forEach(button => {
        button.addEventListener('click', function() {
            if (!this.classList.contains('loading')) {
                const originalText = this.innerHTML;
                const loading = createLoadingAnimation();
                this.classList.add('loading');
                this.innerHTML = '';
                this.appendChild(loading);

                setTimeout(() => {
                    this.classList.remove('loading');
                    this.innerHTML = originalText;
                }, 2000);
            }
        });
    });
}); 