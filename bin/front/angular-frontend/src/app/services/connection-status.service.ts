import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApiConfigService } from './api-config.service';

export interface ConnectionStatus {
  backend: boolean;
  jiraApi: boolean;
  lastChecked: Date;
}

@Injectable({
  providedIn: 'root'
})
export class ConnectionStatusService {
  private connectionStatusSubject = new BehaviorSubject<ConnectionStatus>({
    backend: false,
    jiraApi: false,
    lastChecked: new Date()
  });

  public connectionStatus$ = this.connectionStatusSubject.asObservable();

  constructor(
    private http: HttpClient,
    private apiConfig: ApiConfigService
  ) {
  }

  getCurrentStatus(): ConnectionStatus {
    return this.connectionStatusSubject.value;
  }

  isBackendConnected(): boolean {
    return this.connectionStatusSubject.value.backend;
  }

  isJiraApiConnected(): boolean {
    return this.connectionStatusSubject.value.jiraApi;
  }

  isFullyConnected(): boolean {
    const status = this.connectionStatusSubject.value;
    return status.backend && status.jiraApi;
  }
}
