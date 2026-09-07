import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class PythonConnectorService {

  private readonly baseUrl = 'http://127.0.0.1:8000';


  constructor(private http: HttpClient) {}


  // -------------------------------------------------------------------------
  // ANALYZE CSV
  // -------------------------------------------------------------------------

  analyze(file: File, alpha: number): Observable<any> {

    const formData = new FormData();

    formData.append('file', file);
    formData.append('alpha', alpha.toString());

    return this.http.post<any>(
      `${this.baseUrl}/analyze`,
      formData
    );
  }


  // -------------------------------------------------------------------------
  // COMPLETE FILTERED GRAPH
  // -------------------------------------------------------------------------

  getGraph(): Observable<any> {

    return this.http.get<any>(
      `${this.baseUrl}/graph`
    );
  }


  // -------------------------------------------------------------------------
  // N-PTYCHS
  // -------------------------------------------------------------------------

  getNPtychs(
    nFrom: number,
    nTo: number
  ): Observable<any[]> {

    const params = new HttpParams()
      .set('n_from', nFrom)
      .set('n_to', nTo);

    return this.http.get<any[]>(
      `${this.baseUrl}/h-ptychy`,
      { params }
    );
  }


  // -------------------------------------------------------------------------
  // HOTSPOTS
  // -------------------------------------------------------------------------

  getHotspots(
    minH: number = 2,
    maxH?: number
  ): Observable<any[]> {

    let params = new HttpParams()
      .set('min_h', minH);

    if (maxH !== undefined) {
      params = params.set('max_h', maxH);
    }

    return this.http.get<any[]>(
      `${this.baseUrl}/hotspots`,
      { params }
    );
  }


  // -------------------------------------------------------------------------
  // PATHS
  // -------------------------------------------------------------------------

  getPaths(
    minNodes: number = 2,
    maxNodes?: number
  ): Observable<any[]> {

    let params = new HttpParams()
      .set('min_nodes', minNodes);

    if (maxNodes !== undefined) {
      params = params.set('max_nodes', maxNodes);
    }

    return this.http.get<any[]>(
      `${this.baseUrl}/cesty`,
      { params }
    );
  }

}