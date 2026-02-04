import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, BehaviorSubject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, tap } from 'rxjs/operators';
import { ApiConfigService } from './api-config.service';

export interface GenerateJQLResponse {
  generated_jql: string;
  error?: string;
}

export interface SearchJQLResponse {
  generated_jql: string;
  issues: any[];
  total?: number;
  error?: string;
  jira_error?: string;
}

export interface JiraField {
  id: string;
  name: string;
}

export interface FieldsResponse {
  fields: JiraField[];
  count: number;
}

export interface FieldSuggestion {
  value: string;
  displayName: string;
}

export interface AutocompleteSuggestionsResponse {
  suggestions: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AiJqlService {
  // Subject for debounced autocomplete
  private searchQuerySubject = new Subject<string>();
  private suggestionsSubject = new BehaviorSubject<string[]>([]);
  
  // Observable for suggestions (components subscribe to this)
  suggestions$ = this.suggestionsSubject.asObservable();
  
  // Loading state for suggestions
  private loadingSuggestionsSubject = new BehaviorSubject<boolean>(false);
  loadingSuggestions$ = this.loadingSuggestionsSubject.asObservable();

  constructor(
    private http: HttpClient,
    private apiConfig: ApiConfigService
  ) {
    // Set up debounced autocomplete pipeline
    this.searchQuerySubject.pipe(
      debounceTime(300), // Wait 300ms after user stops typing
      distinctUntilChanged(), // Only if query changed
      tap(() => this.loadingSuggestionsSubject.next(true)),
      switchMap(query => this.fetchSuggestions(query))
    ).subscribe({
      next: (suggestions) => {
        this.suggestionsSubject.next(suggestions);
        this.loadingSuggestionsSubject.next(false);
      },
      error: () => {
        this.suggestionsSubject.next([]);
        this.loadingSuggestionsSubject.next(false);
      }
    });
  }

  // Base URL for AI JQL endpoints (not under /api/jira)
  private readonly aiJqlBaseUrl = 'http://localhost:8000/api/ai/jql';

  /**
   * Generate JQL from natural language text
   */
  generateJQL(text: string): Observable<GenerateJQLResponse> {
    return this.http.post<GenerateJQLResponse>(
      `${this.aiJqlBaseUrl}/generate`,
      { text }
    );
  }

  /**
   * Generate JQL and execute search
   */
  generateAndSearch(text: string, maxResults: number = 20): Observable<SearchJQLResponse> {
    return this.http.post<SearchJQLResponse>(
      `${this.aiJqlBaseUrl}/search`,
      { text, maxResults }
    );
  }

  /**
   * Get available Jira fields for JQL
   */
  getAvailableFields(refresh: boolean = false): Observable<FieldsResponse> {
    const params = refresh ? '?refresh=true' : '';
    return this.http.get<FieldsResponse>(
      `${this.aiJqlBaseUrl}/fields${params}`
    );
  }

  /**
   * Get field value suggestions
   */
  getFieldSuggestions(fieldName: string, fieldValue: string = ''): Observable<{ field_name: string; suggestions: FieldSuggestion[] }> {
    return this.http.post<{ field_name: string; suggestions: FieldSuggestion[] }>(
      `${this.aiJqlBaseUrl}/fields/suggestions`,
      { field_name: fieldName, field_value: fieldValue }
    );
  }

  /**
   * Trigger autocomplete suggestions fetch (debounced)
   * Components should call this on input change
   */
  searchSuggestions(query: string): void {
    this.searchQuerySubject.next(query);
  }

  /**
   * Fetch suggestions from API
   */
  private fetchSuggestions(query: string): Observable<string[]> {
    if (!query || query.length < 1) {
      return of([]);
    }
    
    return this.http.post<AutocompleteSuggestionsResponse>(
      `${this.aiJqlBaseUrl}/suggestions`,
      { query }
    ).pipe(
      switchMap(response => of(response.suggestions || [])),
      catchError(() => of([]))
    );
  }

  /**
   * Get current suggestions synchronously (for immediate display)
   */
  getCurrentSuggestions(): string[] {
    return this.suggestionsSubject.getValue();
  }

  /**
   * Clear suggestions
   */
  clearSuggestions(): void {
    this.suggestionsSubject.next([]);
  }
}
