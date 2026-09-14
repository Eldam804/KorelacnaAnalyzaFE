import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpParams
} from '@angular/common/http';

import {
  forkJoin,
  Observable,
  of,
  switchMap
} from 'rxjs';


export interface CompleteAnalysisResult {
  analysis: any;
  nPtychs: any[];
  paths: any[];
  hotspots: any[];
}


@Injectable({
  providedIn: 'root'
})
export class PythonConnectorService {

  private readonly baseUrl =
    'http://127.0.0.1:8000';


  constructor(
    private http: HttpClient
  ) {}


  analyze(
    file: File,
    alpha: number
  ): Observable<any> {

    const formData =
      new FormData();

    formData.append(
      'file',
      file
    );

    formData.append(
      'alpha',
      alpha.toString()
    );


    return this.http.post<any>(
      `${this.baseUrl}/analyze`,
      formData
    );
  }


  /*
   * Kompletná analýza.
   *
   * Modal čaká až na dokončenie CELÉHO tohto Observable.
   */
  analyzeComplete(
    file: File,
    alpha: number
  ): Observable<CompleteAnalysisResult> {

    return this
      .analyze(
        file,
        alpha
      )
      .pipe(

        switchMap(
          analysis => {

            const graph =
              analysis.graph;


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


            const maximumNPtychSize =
              connectedNodes.size;


            /*
             * K2 už medzi N-ptychy
             * vizuálne nepoužívame.
             */
            const nPtychsRequest =

              maximumNPtychSize >= 3

                ? this.getNPtychs(
                    3,
                    maximumNPtychSize
                  )

                : of<any[]>([]);


            /*
             * Po /analyze už ACTIVE_GRAPH
             * na Pythone existuje.
             *
             * Tieto tri výpočty môžu ísť paralelne.
             */
            return forkJoin({

              analysis:
                of(
                  analysis
                ),

              nPtychs:
                nPtychsRequest,

              paths:
                of<any[]>([]),

              hotspots:
                this.getHotspots(
                  2
                )

            });

          }
        )

      );

  }


  getGraph():
    Observable<any> {

    return this.http.get<any>(
      `${this.baseUrl}/graph`
    );

  }


  getNPtychs(
    nFrom: number,
    nTo: number
  ): Observable<any[]> {

    const params =
      new HttpParams()

        .set(
          'n_from',
          nFrom
        )

        .set(
          'n_to',
          nTo
        );


    return this.http.get<any[]>(
      `${this.baseUrl}/h-ptychy`,
      {
        params
      }
    );

  }


  getHotspots(
    minH: number = 2,
    maxH?: number
  ): Observable<any[]> {

    let params =
      new HttpParams()
        .set(
          'min_h',
          minH
        );


    if (
      maxH !== undefined
    ) {

      params =
        params.set(
          'max_h',
          maxH
        );

    }


    return this.http.get<any[]>(
      `${this.baseUrl}/hotspots`,
      {
        params
      }
    );

  }


  getPaths(
    minNodes: number = 2,
    maxNodes?: number
  ): Observable<any[]> {

    let params =
      new HttpParams()
        .set(
          'min_nodes',
          minNodes
        );


    if (
      maxNodes !== undefined
    ) {

      params =
        params.set(
          'max_nodes',
          maxNodes
        );

    }


    return this.http.get<any[]>(
      `${this.baseUrl}/cesty`,
      {
        params
      }
    );

  }

}