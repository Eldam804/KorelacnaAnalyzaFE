import { Component } from '@angular/core';

import { PythonConnectorService } from './backend/python-connector.service';

import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  catchError,
  finalize,
  forkJoin,
  of,
  switchMap,
  tap
} from 'rxjs';

import {
  AddFilesComponent,
  AddFilesDialogResult
} from './components/modals/add-files/add-files.component';

import {
  DebugWindowComponent,
  DebugWindowData
} from './components/modals/debug-window/debug-window.component';


export type GraphType =
  | 'n-ptychs'
  | 'paths'
  | 'hotspots';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {


  // -------------------------------------------------------------------------
  // VIEW
  // -------------------------------------------------------------------------

  selectedGraphType: GraphType = 'n-ptychs';


  // -------------------------------------------------------------------------
  // ANALYSIS DATA
  // -------------------------------------------------------------------------

  /*
   * Kompletný response z /analyze.
   */
  analysisResult: any | null = null;


  /*
   * Celý prefiltrovaný korelačný graf.
   *
   * Viewer ho momentálne priamo nezobrazuje,
   * ale potrebujeme ho pre debug a ďalšie analýzy.
   */
  graphData: any | null = null;


  /*
   * VŠETKY N-ptychy.
   */
  nPtychsData: any[] | null = null;


  /*
   * VŠETKY cesty.
   */
  pathsData: any[] | null = null;


  /*
   * VŠETKY hotspoty.
   */
  hotspotsData: any[] | null = null;


  // -------------------------------------------------------------------------
  // DATASET INFO
  // -------------------------------------------------------------------------

  loadedFileName: string | null = null;

  currentAlpha: number | null = null;


  // -------------------------------------------------------------------------
  // LOADING
  // -------------------------------------------------------------------------

  /*
   * Toto teraz pokrýva:
   *
   * 1. CSV analýzu
   * 2. výpočet N-ptychov
   * 3. výpočet ciest
   * 4. výpočet hotspotov
   *
   * Čiže loading skončí až keď máme všetko.
   */
  isLoading = false;


  constructor(
    private pythonConnector: PythonConnectorService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}


  // =========================================================================
  // NAVIGATION
  // =========================================================================

  selectGraphType(
    type: GraphType
  ): void {

    this.selectedGraphType = type;

  }


  // =========================================================================
  // ADD FILE MODAL
  // =========================================================================

  openAddFiles(): void {

  const dialogRef =
    this.dialog.open(
      AddFilesComponent,
      {
        width: '460px',
        maxWidth: '92vw',
        disableClose: true
      }
    );


  dialogRef
    .afterClosed()
    .subscribe(
      (
        result:
          AddFilesDialogResult |
          undefined
      ) => {

        /*
         * Cancel.
         */
        if (!result) {
          return;
        }


        /*
         * ANALÝZA JE V TEJTO CHVÍLI
         * UŽ KOMPLETNE HOTOVÁ.
         */


        this.analysisResult =
          result.analysis;


        this.graphData =
          result.analysis.graph;


        this.nPtychsData =
          result.nPtychs;


        this.pathsData =
          result.paths;


        this.hotspotsData =
          result.hotspots;


        this.loadedFileName =
          result.analysis.file;


        this.currentAlpha =
          result.analysis.alpha;


        this.selectedGraphType =
          'n-ptychs';


        console.log(
          'COMPLETE ANALYSIS:',
          result
        );


        console.log(
          'N-PTYCH COUNT:',
          result.nPtychs.length
        );


        console.log(
          'PATH COUNT:',
          result.paths.length
        );


        console.log(
          'HOTSPOT COUNT:',
          result.hotspots.length
        );


        this.snackBar.open(

          `Dataset "${result.analysis.file}" bol analyzovaný.`,

          'OK',

          {
            duration: 3000
          }

        );

      }
    );

}


  // =========================================================================
  // DEBUG MODAL
  // =========================================================================

  openDebugWindow(): void {

    const debugData:
      DebugWindowData = {

      analysis:
        this.analysisResult,

      graph:
        this.graphData,

      nPtychs:
        this.nPtychsData,

      paths:
        this.pathsData,

      hotspots:
        this.hotspotsData

    };


    this.dialog.open(
      DebugWindowComponent,
      {
        width: '900px',
        maxWidth: '92vw',
        maxHeight: '88vh',
        data: debugData
      }
    );

  }


  // =========================================================================
  // COMPLETE ANALYSIS
  // =========================================================================

  analyzeCsv(
    file: File,
    alpha: number
  ): void {


    // -----------------------------------------------------------------------
    // RESET
    // -----------------------------------------------------------------------

    this.isLoading = true;

    this.analysisResult = null;

    this.graphData = null;

    this.nPtychsData = null;

    this.pathsData = null;

    this.hotspotsData = null;

    this.loadedFileName = null;

    this.currentAlpha = null;


    /*
     * Po každom novom datasete začíname
     * v N-ptych hierarchy view.
     */
    this.selectedGraphType =
      'n-ptychs';


    // -----------------------------------------------------------------------
    // ANALYZE
    // -----------------------------------------------------------------------

    this.pythonConnector
      .analyze(
        file,
        alpha
      )

      .pipe(


        // -------------------------------------------------------------------
        // SAVE ANALYSIS RESULT
        // -------------------------------------------------------------------

        tap(
          response => {

            console.log(
              'ANALYZE:',
              response
            );


            this.analysisResult =
              response;


            this.graphData =
              response.graph;


            this.loadedFileName =
              response.file;


            this.currentAlpha =
              response.alpha;

          }
        ),


        // -------------------------------------------------------------------
        // AFTER ANALYSIS -> LOAD ALL STRUCTURES
        // -------------------------------------------------------------------

        switchMap(
          response => {

            const graph =
              response.graph;


            /*
             * Maximálna možná veľkosť N-ptychu.
             *
             * Izolované nodes ignorujeme,
             * pretože nemôžu byť ani K2.
             */
            const maximumNPtychSize =
              this.getMaximumNPtychSize(
                graph
              );


            console.log(
              'Maximum possible N-ptych size:',
              maximumNPtychSize
            );


            /*
             * Ak graf nemá ani jednu hranu,
             * N-ptychy nemajú zmysel volať.
             */
            const nPtychsRequest =

              maximumNPtychSize >= 2

                ? this.pythonConnector
                    .getNPtychs(
                      2,
                      maximumNPtychSize
                    )

                : of<any[]>([]);


            /*
             * Všetky tri analytické časti
             * spustíme PARALELNE.
             *
             * Python teda počíta:
             *
             * N-ptychy
             * Cesty
             * Hotspoty
             *
             * a Angular čaká, kým všetko skončí.
             */
            return forkJoin({


              // -------------------------------------------------------------
              // N-PTYCHS
              // -------------------------------------------------------------

              nPtychs:
                nPtychsRequest.pipe(

                  catchError(
                    error => {

                      console.error(
                        'N-PTYCH ERROR:',
                        error
                      );


                      return of<any[]>(
                        []
                      );

                    }
                  )

                ),


              // -------------------------------------------------------------
              // PATHS
              // -------------------------------------------------------------

              paths:
                this.pythonConnector
                  .getPaths(
                    2
                  )
                  .pipe(

                    catchError(
                      error => {

                        console.error(
                          'PATH ERROR:',
                          error
                        );


                        return of<any[]>(
                          []
                        );

                      }
                    )

                  ),


              // -------------------------------------------------------------
              // HOTSPOTS
              // -------------------------------------------------------------

              hotspots:
                this.pythonConnector
                  .getHotspots(
                    2
                  )
                  .pipe(

                    catchError(
                      error => {

                        console.error(
                          'HOTSPOT ERROR:',
                          error
                        );


                        return of<any[]>(
                          []
                        );

                      }
                    )

                  )

            });

          }
        ),


        // -------------------------------------------------------------------
        // LOADING FINISH
        // -------------------------------------------------------------------

        finalize(
          () => {

            this.isLoading =
              false;

          }
        )

      )


      .subscribe({

        next: result => {

          this.nPtychsData =
            result.nPtychs;


          this.pathsData =
            result.paths;


          this.hotspotsData =
            result.hotspots;

          console.log(
            '======================================'
          );

          console.log(
            'COMPLETE ANALYSIS FINISHED'
          );

          console.log(
            'N-PTYCHS:',
            this.nPtychsData
          );

          console.log(
            'PATHS:',
            this.pathsData
          );

          console.log(
            'HOTSPOTS:',
            this.hotspotsData
          );

          console.log(
            '======================================'
          );


          console.log(
            'N-PTYCH COUNT:',
            this.nPtychsData.length
          );

          console.log(
            'PATH COUNT:',
            this.pathsData.length
          );

          console.log(
            'HOTSPOT COUNT:',
            this.hotspotsData.length
          );

          this.snackBar.open(

            `Dataset "${this.loadedFileName}" bol analyzovaný.`,

            'OK',

            {
              duration: 3000
            }

          );

        },

        error: error => {

          console.error(
            'ANALYZE ERROR:',
            error
          );


          this.snackBar.open(

            error?.error?.detail ??
            'Chyba pri analýze CSV.',

            'OK',

            {
              duration: 5000
            }

          );

        }

      });

  }


  private getMaximumNPtychSize(
    graph: any
  ): number {

    const connectedNodes =
      new Set<string>();


    for (
      const edge
      of graph?.edges ?? []
    ) {

      connectedNodes.add(
        edge.source
      );


      connectedNodes.add(
        edge.target
      );

    }


    return connectedNodes.size;

  }


  loadGraph(): void {

    this.pythonConnector
      .getGraph()
      .subscribe({

        next: response => {

          console.log(
            'GRAPH:',
            response
          );


          this.graphData =
            response;

        },

        error: error => {

          console.error(
            'GRAPH ERROR:',
            error
          );

        }

      });

  }


  loadNPtychs(
    nFrom: number,
    nTo: number
  ): void {

    this.pythonConnector
      .getNPtychs(
        nFrom,
        nTo
      )
      .subscribe({

        next: response => {

          console.log(
            'N-PTYCHS:',
            response
          );


          this.nPtychsData =
            response;

        },

        error: error => {

          console.error(
            'N-PTYCH ERROR:',
            error
          );

        }

      });

  }


  loadHotspots(
    minH: number = 2,
    maxH?: number
  ): void {

    this.pythonConnector
      .getHotspots(
        minH,
        maxH
      )
      .subscribe({

        next: response => {

          console.log(
            'HOTSPOTS:',
            response
          );


          this.hotspotsData =
            response;

        },

        error: error => {

          console.error(
            'HOTSPOT ERROR:',
            error
          );

        }

      });

  }


  loadPaths(
    minNodes: number = 2,
    maxNodes?: number
  ): void {

    this.pythonConnector
      .getPaths(
        minNodes,
        maxNodes
      )
      .subscribe({

        next: response => {

          console.log(
            'PATHS:',
            response
          );


          this.pathsData =
            response;

        },

        error: error => {

          console.error(
            'PATH ERROR:',
            error
          );

        }

      });

  }

}