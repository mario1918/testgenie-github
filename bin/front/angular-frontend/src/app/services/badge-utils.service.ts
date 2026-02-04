import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class BadgeUtilsService {

  getStatusBadgeClass(status?: string): { class: string; style: string } {
    const statusColors: { [key: string]: string } = {
      'to-do': '#BFC1C4',
      'open': '#CECFD2',
      'in progress': '#8FB8F6',
      'closed': '#B3DF72',
      'done': '#B3DF72',
      'resolved': '#B3DF72',
      'reopened': '#BFC1C4',
      'in qa': '#8FB8F6'
    };
    
    const normalizedStatus = status?.toLowerCase() || '';
    const bgColor = statusColors[normalizedStatus] || '#E9ECEF';
    
    return {
      class: 'badge',
      style: `background-color: ${bgColor}; color: #000;`
    };
  }

  getIssueTypeBadgeClass(issueType: string): { class: string; style: string } {
    const issueTypeColors: { [key: string]: string } = {
      'story': '#82B536',
      'bug': '#E2483D',
      'new feature': '#82B536',
      'sub-task': '#4688EC',
      'subtask': '#4688EC',
      'test': '#8FB8F6',
      'epic': '#BF63F3',
      'task': '#669DF1',
      'ux-task': '#BF63F3',
      'architect-task': '#669DF1',
      'function request': '#BF63F3'
    };
    
    const normalizedType = issueType?.toLowerCase() || '';
    const bgColor = issueTypeColors[normalizedType] || '#E9ECEF';
    
    return {
      class: 'badge',
      style: `background-color: ${bgColor}; color: #fff;`
    };
  }

  getPriorityBadgeClass(priority: string): { class: string; style: string } {
    const priorityColors: { [key: string]: string } = {
      'critical': '#E2483D',
      'highest': '#E2483D',
      'high': '#E2483D',
      'major': '#F68909',
      'medium': '#F68909',
      'minor': '#4688EC',
      'low': '#4688EC',
      'lowest': '#6C757D'
    };
    
    const normalizedPriority = priority?.toLowerCase() || '';
    const bgColor = priorityColors[normalizedPriority] || '#6C757D';
    
    return {
      class: 'badge',
      style: `background-color: ${bgColor}; color: #fff;`
    };
  }

  truncateText(text: string, maxLength: number = 100): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  // Bootstrap badge classes for components
  getComponentBadgeClass(component: string | undefined): string {
    const map: { [key: string]: string } = {
      'Alert': 'badge bg-danger text-white',
      'Admin': 'badge bg-primary text-white',
      'BOM': 'badge bg-success text-white',
      'Dashboard': 'badge bg-info text-white',
      'Reports': 'badge bg-warning text-dark',
      'Supply Chain': 'badge bg-secondary text-white'
    };
    return map[component || ''] || 'badge bg-light text-dark';
  }

  // Bootstrap badge classes for status
  getStatusBadgeClassTailwind(status: string | undefined): string {
    const map: { [key: string]: string } = {
      'To Do': 'badge bg-secondary',
      'In Progress': 'badge bg-primary',
      'Done': 'badge bg-success'
    };
    return map[status || ''] || 'badge bg-light text-dark';
  }

  // Bootstrap badge classes for priority
  getPriorityBadgeClassTailwind(priority: string | undefined): string {
    const map: { [key: string]: string } = {
      'Highest': 'badge bg-danger',
      'High': 'badge bg-warning text-dark',
      'Medium': 'badge bg-info',
      'Low': 'badge bg-success',
      'Lowest': 'badge bg-secondary',
      'high': 'badge bg-warning text-dark',
      'medium': 'badge bg-info',
      'low': 'badge bg-success'
    };
    return map[priority || ''] || 'badge bg-light text-dark';
  }
}
