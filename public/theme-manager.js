class ThemeManager {
    constructor() {
        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = this.themeToggle?.querySelector('i');
        this.STORAGE_KEY = 'talknote_theme';
        this.themes = ['auto', 'light', 'dark'];
    }

    init() {
        this.loadTheme();
        this.bindEvents();
        this.updateIcon();
    }

    getPreferredTheme() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored && this.themes.includes(stored)) {
            return stored;
        }
        
        // Check system preference
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        
        return 'light';
    }

    getActualTheme() {
        const theme = this.getPreferredTheme();
        if (theme === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return theme;
    }

    loadTheme() {
        const theme = this.getPreferredTheme();
        document.documentElement.setAttribute('data-theme', theme);
        
        // Update meta theme-color for mobile browsers
        const themeColor = this.getActualTheme() === 'dark' ? '#000000' : '#ffffff';
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = themeColor;
    }

    saveTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
    }

    cycleTheme() {
        const current = this.getPreferredTheme();
        const currentIndex = this.themes.indexOf(current);
        const nextIndex = (currentIndex + 1) % this.themes.length;
        const nextTheme = this.themes[nextIndex];
        
        this.setTheme(nextTheme);
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.saveTheme(theme);
        this.updateIcon();
        
        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('themechange', { 
            detail: { theme: this.getActualTheme() }
        }));
    }

    updateIcon() {
        if (!this.themeIcon) return;
        
        const theme = this.getPreferredTheme();
        const actual = this.getActualTheme();
        
        if (theme === 'auto') {
            this.themeIcon.className = actual === 'dark' ? 'fas fa-adjust' : 'fas fa-circle-half-stroke';
        } else if (theme === 'dark') {
            this.themeIcon.className = 'fas fa-moon';
        } else {
            this.themeIcon.className = 'fas fa-sun';
        }
    }

    bindEvents() {
        // Theme toggle button
        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => this.cycleTheme());
        }

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.getPreferredTheme() === 'auto') {
                this.loadTheme();
                this.updateIcon();
            }
        });

        // Listen for theme changes from other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === this.STORAGE_KEY) {
                this.loadTheme();
                this.updateIcon();
            }
        });
    }

    // Utility method for other pages
    static applyThemeToNewPage() {
        const manager = new ThemeManager();
        manager.loadTheme();
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeManager;
}