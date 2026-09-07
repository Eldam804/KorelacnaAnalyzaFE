import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

export interface AddFilesDialogResult {
  file: File;
  alpha: number;
}

@Component({
  selector: 'app-add-files',
  templateUrl: './add-files.component.html',
  styleUrls: ['./add-files.component.css']
})
export class AddFilesComponent {

  selectedFile: File | null = null;
  alpha = 0;
  errorMessage = '';

  constructor(
    private dialogRef: MatDialogRef<AddFilesComponent>
  ) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];

    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.selectedFile = null;
      this.errorMessage = 'Vyber CSV súbor.';
      return;
    }

    this.selectedFile = file;
    this.errorMessage = '';
  }

  removeFile(): void {
    this.selectedFile = null;
  }

  submit(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Najprv vyber CSV súbor.';
      return;
    }

    if (this.alpha < 0 || this.alpha > 1) {
      this.errorMessage = 'Alpha musí byť medzi 0 a 1.';
      return;
    }

    this.dialogRef.close({
      file: this.selectedFile,
      alpha: this.alpha
    } as AddFilesDialogResult);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}