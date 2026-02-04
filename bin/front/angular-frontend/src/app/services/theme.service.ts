import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'preferred-theme';
  private readonly THEME_LIGHT = 'light';
  private readonly THEME_DARK = 'dark';

  private themeSubject = new BehaviorSubject<string>(this.THEME_LIGHT);
  public theme$ = this.themeSubject.asObservable();

  constructor() {
    this.initTheme();
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem(this.THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? this.THEME_DARK : this.THEME_LIGHT);
    
    this.setTheme(theme);
  }

  setTheme(theme: string): void {
    document.documentElement.setAttribute('data-bs-theme', theme);
    const themeStylesheet = document.getElementById('theme-stylesheet') as HTMLLinkElement;
    
    if (themeStylesheet) {
      if (theme === this.THEME_DARK) {
        themeStylesheet.media = 'all';
      } else {
        themeStylesheet.media = 'not all';
      }
    }
    
    localStorage.setItem(this.THEME_KEY, theme);
    this.themeSubject.next(theme);
  }

  toggleTheme(): void {
    const currentTheme = this.themeSubject.value;
    const newTheme = currentTheme === this.THEME_LIGHT ? this.THEME_DARK : this.THEME_LIGHT;
    this.setTheme(newTheme);
  }

  getCurrentTheme(): string {
    return this.themeSubject.value;
  }

  isDarkTheme(): boolean {
    return this.themeSubject.value === this.THEME_DARK;
  }
}
