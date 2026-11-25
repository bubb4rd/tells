window.App = { count: Number(localStorage.getItem('n') || 0), bump() { this.count++; localStorage.setItem('n', this.count); } };
