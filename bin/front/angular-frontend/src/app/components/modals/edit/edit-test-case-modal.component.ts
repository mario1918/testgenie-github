import { Component, inject, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestCaseModalComponent } from '../base/test-case-modal.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { JiraService } from '../../../services/jira.service';
import { TestCaseService } from '../../../services/test-case.service';
import { ZephyrService } from '../../../services/zephyr.service';
import { EditTestCaseForm } from '../../../models/form.model';
import { TestCase } from '../../../models/test-case.model';

/** Strongly-typed field lists */
const JIRA_FIELDS = [
  'summary',
  'description',
  'component',
  'sprint',
  'status',
  'priority',
  'relatedTask',
] as const satisfies readonly (keyof EditTestCaseForm)[];

const ZEPHYR_FIELDS = ['steps', 'expectedResult'] as const satisfies readonly (keyof EditTestCaseForm)[];

type JiraKey = typeof JIRA_FIELDS[number];
type ZephyrKey = typeof ZEPHYR_FIELDS[number];

/** Type guards to narrow string -> JiraKey/ZephyrKey */
function isJiraKey(k: string): k is JiraKey {
  return (JIRA_FIELDS as readonly string[]).includes(k);
}
function isZephyrKey(k: string): k is ZephyrKey {
  return (ZEPHYR_FIELDS as readonly string[]).includes(k);
}

@Component({
  selector: 'app-edit-test-case-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TestCaseModalComponent],
  templateUrl: './edit-test-case-modal.component.html',
  styles: []
})
export class EditTestCaseModalComponent implements OnChanges {
  jiraService = inject(JiraService);
  testCaseService = inject(TestCaseService);
  zephyrService = inject(ZephyrService);

  @Input() isVisible: boolean = false;
  @Input() testCase: TestCase | null = null;
  @Output() closeModal = new EventEmitter<void>();

  transitions: any[] = [];
  isLoadingTransitions = false;
  // Indicates whether the update action is in progress
  saving: boolean = false;

  formData: EditTestCaseForm = {
    key: '',
    jiraID: '',
    summary: '',
    description: '',
    component: '',
    sprint: '',
    status: '',
    priority: '',
    relatedTask: '',
    steps: '',
    expectedResult: '',
    transition: '',
  };

  private originalFormData: EditTestCaseForm = {
    key: '',
    jiraID: '',
    summary: '',
    description: '',
    component: '',
    sprint: '',
    status: '',
    priority: '',
    relatedTask: '',
    steps: '',
    expectedResult: '',
    transition: '',
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['testCase'] && this.testCase) {
      this.populateForm(this.testCase);
    }
  }

  async handleSubmit(): Promise<void> {
    if (this.saving) return;
    this.saving = true;

    const changedFields = this.getChangedFields();
    const needsJiraUpdate = this.shouldCallJiraAPI(changedFields);
    const needsZephyrUpdate = this.shouldCallZephyrAPI(changedFields);

    try {
      let success = true;

      if (needsJiraUpdate) {
        const jiraSuccess = await this.updateJiraFields();
        success = success && jiraSuccess;
      }

      if (needsZephyrUpdate) {
        const zephyrSuccess = await this.updateZephyrFields();
        success = success && zephyrSuccess;
      }

      if (!needsJiraUpdate && !needsZephyrUpdate) {
        success = await this.testCaseService.updateTestCase(this.formData);
      }

      if (success) {
        this.close();
        this.testCaseService.loadTestCases();
      }
    } catch (error) {
      console.error('Error updating test case:', error);
    } finally {
      this.saving = false;
    }
  }

  close(): void {
    this.closeModal.emit();
  }

  isCurrentStatusInTransitions(): boolean {
    if (!this.formData.status) return false;
    return this.jiraService.getTransitionsData().some(t => t.name === this.formData.status);
  }

  private async populateForm(testCase: TestCase): Promise<void> {
    this.formData = { 
      key: testCase.id,
      jiraID: testCase.jiraID || '',
      summary: testCase.summary || '',
      description: testCase.description || '',
      component: testCase.component || '',
      sprint: testCase.sprint || '',
      status: testCase.status || '',
      priority: testCase.priority || '',
      relatedTask: testCase.relatedTask || '',
      steps: testCase.steps || '',
      expectedResult: testCase.expectedResult || '',
      transition: ''
    };
    this.originalFormData = { ...this.formData };
    
    // Load transitions if we have a JIRA key
    await this.loadTransitions();
  }

  private async loadTransitions(): Promise<void> {
    if (!this.formData.key) return;
    
    this.isLoadingTransitions = true;
    try {
      this.transitions = await this.jiraService.listTransitions(this.formData.jiraID);
    } catch (error) {
      console.error('Error loading transitions:', error);
      this.transitions = [];
    } finally {
      this.isLoadingTransitions = false;
    }
  }

  private getChangedFields(): string[] {
    const changed: string[] = [];
    (Object.keys(this.formData) as (keyof EditTestCaseForm)[]).forEach((key) => {
      if (this.formData[key] !== this.originalFormData[key]) {
        changed.push(String(key));
      }
    });
    return changed;
  }

  private shouldCallJiraAPI(changedFields: string[]): boolean {
    return changedFields.some(isJiraKey);
  }

  private shouldCallZephyrAPI(changedFields: string[]): boolean {
    return changedFields.some(isZephyrKey);
  }

  private async updateJiraFields(): Promise<boolean> {
    const changed = this.getChangedFields();
    const updatedJiraKeys = changed.filter(isJiraKey); // JiraKey[]

    if (updatedJiraKeys.length === 0) {
      return true; // nothing to update
    }

    // Only allowed Jira keys + jiraID + id
    const jiraData: { id: string; jiraID: string } & Partial<Pick<EditTestCaseForm, JiraKey>> = {
      id: this.formData.key,
      jiraID: this.formData.jiraID
    };

    for (const key of updatedJiraKeys) {
      const value = this.formData[key]; // key is JiraKey => safe index
      if (value !== undefined && value !== null && value !== '') {
        jiraData[key] = value;
      }
    }

    try {
      return await this.jiraService.updateTestCase(jiraData);
    } catch (error) {
      console.error('Error updating Jira fields:', error);
      return false;
    }
  }

  private async updateZephyrFields(): Promise<boolean> {
    // Use only the Zephyr keys that actually changed
    const changed = this.getChangedFields();
    const updatedZephyrKeys = changed.filter(isZephyrKey); // ZephyrKey[]

    if (updatedZephyrKeys.length === 0) {
      return true;
    }

    const zephyrData: { id: string; jiraID: string } & Partial<Pick<EditTestCaseForm, ZephyrKey>> = {
      id: this.formData.key,
      jiraID: this.formData.jiraID
    };

    for (const key of updatedZephyrKeys) {
      const value = this.formData[key];
      if (value !== undefined && value !== null && value !== '') {
        zephyrData[key] = value;
      }
    }

    try {
      return await this.zephyrService.updateTestCase(zephyrData);
    } catch (error) {
      console.error('Error updating Zephyr fields:', error);
      return false;
    }
  }
}
