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
  PythonConnectorService
} from '../../../backend/python-connector.service';


export interface AddFilesDialogResult
  extends CompleteAnalysisResult {

  file: File;

  alpha: number;
}


@Component({
  selector: 'app-add-files',
  templateUrl: './add-files.component.html',
  styleUrls: ['./add-files.component.css']
})
export class AddFilesComponent {


  selectedFile:
    File | null = null;


  alpha =
    0;


  errorMessage =
    '';


  /*
   * Spinner state modalu.
   */
  isLoading =
    false;


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

    if (
      this.isLoading
    ) {
      return;
    }


    const input =
      event.target as
        HTMLInputElement;


    const file =
      input.files?.[0];


    if (!file) {
      return;
    }


    if (
      !file.name
        .toLowerCase()
        .endsWith('.csv')
    ) {

      this.errorMessage =
        'Vyber súbor vo formáte CSV.';


      this.selectedFile =
        null;


      input.value =
        '';


      return;

    }


    this.errorMessage =
      '';


    this.selectedFile =
      file;

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


    this.errorMessage = '';
    this.isLoading = true;


    if (
      this.alpha < 0 ||
      this.alpha > 1
    ) {

      this.errorMessage =
        'Alpha musí byť v rozsahu 0 až 1.';

      return;

    }


    this.errorMessage =
      '';


    /*
     * MODAL OSTÁVA OTVORENÝ.
     */
    this.isLoading =
      true;


    this.pythonConnector
      .analyzeComplete(
        this.selectedFile,
        this.alpha
      )

      .pipe(

        finalize(
          () => {

            this.isLoading =
              false;

          }
        )

      )

      .subscribe({

        next: result => {

          /*
           * Až TERAZ modal zatvoríme.
           *
           * Máme:
           *
           * - analysis
           * - nPtychs
           * - paths
           * - hotspots
           */
          this.dialogRef.close({

            file:
              this.selectedFile!,

            alpha:
              this.alpha,

            analysis:
              result.analysis,

            nPtychs:
              result.nPtychs,

            paths:
              result.paths,

            hotspots:
              result.hotspots

          });

        },


        error: error => {

          console.error(
            'COMPLETE ANALYSIS ERROR:',
            error
          );


          /*
           * Modal sa pri chybe NEZAVRIE.
           *
           * Používateľ môže upraviť parametre
           * alebo skúsiť dataset znovu.
           */
          this.errorMessage =

            error?.error?.detail ??

            error?.message ??

            'Pri analýze datasetu nastala chyba.';

        }

      });

  }


  cancel(): void {

    if (
      this.isLoading
    ) {

      return;

    }


    this.dialogRef.close();

  }

}