import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-warning-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './warning-icon.component.html',
  styles: []
})
export class WarningIconComponent {
  @Input() tooltip: string = 'No execution found - Click to add';
  @Output() clicked = new EventEmitter<void>();

  onClick(): void {
    this.clicked.emit();
  }
}
