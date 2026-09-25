import {
  Component
} from '@angular/core';

import {
  MatDialogRef
} from '@angular/material/dialog';

import {
  finalize
} from 'rxjs';

import {
  CompleteAnalysisResult,
  CorrelationMethod,
  PythonConnectorService
} from '../../../backend/python-connector.service';

export interface AddFilesDialogResult
  extends CompleteAnalysisResult {

  file: File;

  alpha: number;

  method: CorrelationMethod;
}

@Component({
  selector: 'app-add-files',
  templateUrl: './add-files.component.html',
  styleUrls: ['./add-files.component.css']
})
export class AddFilesComponent {

  selectedFile: File | null = null;

  alpha = 0;

  correlationMethod: CorrelationMethod = 'pearson';

  errorMessage = '';

  isLoading = false;
  isDragOver = false;
  private dragDepth = 0;

  constructor(
    private dialogRef:
      MatDialogRef<
        AddFilesComponent,
        AddFilesDialogResult
      >,
    private pythonConnector:
      PythonConnectorService
  ) {}

  onFileSelected(
    event: Event
  ): void {

    if (this.isLoading) {
      return;
    }

    const input =
      event.target as HTMLInputElement;

    const file =
      input.files?.[0];

    if (!file) {
      return;
    }

    if (!this.trySelectFile(file)) {
      input.value = '';
    }
  }

 onDragEnter(
  event: DragEvent
): void {

  event.preventDefault();
  event.stopPropagation();

  if (this.isLoading) {
    return;
  }

  this.dragDepth++;

  this.isDragOver = true;

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

onDragOver(
  event: DragEvent
): void {

  event.preventDefault();
  event.stopPropagation();

  if (this.isLoading) {
    return;
  }

  this.isDragOver = true;

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

onDragLeave(
  event: DragEvent
): void {

  event.preventDefault();
  event.stopPropagation();

  if (this.isLoading) {
    return;
  }

  this.dragDepth = Math.max(
    0,
    this.dragDepth - 1
  );

  if (this.dragDepth === 0) {
    this.isDragOver = false;
  }
}

onFileDrop(
  event: DragEvent
): void {

  event.preventDefault();
  event.stopPropagation();

  this.dragDepth = 0;
  this.isDragOver = false;

  if (this.isLoading) {
    return;
  }

  const file =
    event.dataTransfer?.files?.[0];

  if (!file) {
    return;
  }

    this.trySelectFile(file);
  }

  private trySelectFile(
    file: File
  ): boolean {

    if (
      !file.name
        .toLowerCase()
        .endsWith('.csv')
    ) {
      this.errorMessage =
        'Choose a file in CSV format.';

      this.selectedFile = null;

      return false;
    }

    this.errorMessage = '';

    this.selectedFile = file;

    return true;
  }

  removeFile(): void {

    if (this.isLoading) {
      return;
    }

    this.selectedFile = null;

    this.errorMessage = '';
  }

  submit(): void {

    if (
      !this.selectedFile ||
      this.isLoading
    ) {
      return;
    }

    if (
      this.alpha < 0 ||
      this.alpha > 1
    ) {
      this.errorMessage =
        'Alpha must be between 0 and 1.';

      return;
    }

    this.errorMessage = '';

    this.isLoading = true;

    this.pythonConnector
      .analyzeComplete(
        this.selectedFile,
        this.alpha,
        this.correlationMethod
      )
      .pipe(
        finalize(
          () => {
            this.isLoading = false;
          }
        )
      )
      .subscribe({

        next: result => {

          this.dialogRef.close({

            file: this.selectedFile!,

            alpha: this.alpha,

            method: this.correlationMethod,

            analysis: result.analysis,

            nPtychs: result.nPtychs,

            paths: result.paths,

            hotspots: result.hotspots
          });
        },

        error: error => {

          console.error(
            'COMPLETE ANALYSIS ERROR:',
            error
          );

          this.errorMessage =
            error?.error?.detail ??
            error?.message ??
            'An error occurred while analyzing the dataset.';
        }
      });
  }

  cancel(): void {

    if (this.isLoading) {
      return;
    }

    this.dialogRef.close();
  }
}