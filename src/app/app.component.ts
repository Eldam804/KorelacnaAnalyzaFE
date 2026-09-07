import { Component } from '@angular/core';
import { PythonConnectorService } from './backend/python-connector.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';

import {
  AddFilesComponent,
  AddFilesDialogResult
} from './components/modals/add-files/add-files.component';
import {
  DebugWindowComponent,
  DebugWindowData
} from './components/modals/debug-window/debug-window.component';

export type GraphType = 'graph' | 'n-ptychs' | 'paths' | 'hotspots';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {

  selectedGraphType: GraphType = 'graph';
  analysisResult: any | null = null;
  graphData: any | null = null;
  loadedFileName: string | null = null;
  currentAlpha: number | null = null;
  nPtychsData: any[] | null = null;
  pathsData: any[] | null = null;
  hotspotsData: any[] | null = null;
  isLoading = false;


  constructor(
    private pythonConnector: PythonConnectorService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}


  selectGraphType(type: GraphType): void {
    this.selectedGraphType = type;
  }


  openAddFiles(): void {

  const dialogRef = this.dialog.open(AddFilesComponent, {
    width: '460px',
    maxWidth: '92vw',
    disableClose: true
  });


  dialogRef
    .afterClosed()
    .subscribe((result: AddFilesDialogResult | undefined) => {

      if (!result) {
        return;
      }

      this.analyzeCsv(
        result.file,
        result.alpha
      );

    });

}


  openDebugWindow(): void {

  const debugData: DebugWindowData = {

    analysis: this.analysisResult,

    graph: this.graphData,

    nPtychs: this.nPtychsData,

    paths: this.pathsData,

    hotspots: this.hotspotsData

  };


  this.dialog.open(DebugWindowComponent, {

    width: '900px',

    maxWidth: '92vw',

    maxHeight: '88vh',

    data: debugData

  });

}


  // -------------------------------------------------------------------------
  // BACKEND CALLS
  // -------------------------------------------------------------------------

  analyzeCsv(file: File, alpha: number): void {
  this.isLoading = true;

  this.pythonConnector
    .analyze(file, alpha)
    .pipe(
      finalize(() => {
        this.isLoading = false;
      })
    )
    .subscribe({
      next: response => {
        console.log('ANALYZE:', response);

        this.analysisResult = response;
        this.graphData = response.graph;
        this.loadedFileName = response.file;
        this.currentAlpha = response.alpha;

        this.snackBar.open(
          `Dataset "${response.file}" bol analyzovaný.`,
          'OK',
          {
            duration: 3000
          }
        );
      },

      error: error => {
        console.error('ANALYZE ERROR:', error);

        this.snackBar.open(
          error?.error?.detail ?? 'Chyba pri analýze CSV.',
          'OK',
          {
            duration: 5000
          }
        );
      }
    });
}


  loadGraph(): void {

  this.pythonConnector
    .getGraph()
    .subscribe(response => {

      console.log('GRAPH:', response);

      this.graphData = response;

    });

  }


  loadNPtychs(
    nFrom: number,
    nTo: number
  ): void {

    this.pythonConnector
      .getNPtychs(nFrom, nTo)
      .subscribe(response => {

        console.log('N-PTYCHS:', response);

        this.nPtychsData = response;

      });

  }


  loadHotspots(
    minH: number = 2,
    maxH?: number
  ): void {

    this.pythonConnector
      .getHotspots(minH, maxH)
      .subscribe(response => {

        console.log('HOTSPOTS:', response);

        this.hotspotsData = response;

      });

  }


  loadPaths(
    minNodes: number = 2,
    maxNodes?: number
  ): void {

    this.pythonConnector
      .getPaths(minNodes, maxNodes)
      .subscribe(response => {

        console.log('PATHS:', response);

        this.pathsData = response;

      });

  }

}