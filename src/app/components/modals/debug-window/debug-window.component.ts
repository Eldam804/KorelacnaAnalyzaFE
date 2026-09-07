import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef
} from '@angular/material/dialog';


export interface DebugWindowData {
  analysis: any | null;
  graph: any | null;
  nPtychs: any[] | null;
  paths: any[] | null;
  hotspots: any[] | null;
}


@Component({
  selector: 'app-debug-window',
  templateUrl: './debug-window.component.html',
  styleUrls: ['./debug-window.component.css']
})
export class DebugWindowComponent {

  constructor(
    @Inject(MAT_DIALOG_DATA)
    public data: DebugWindowData,

    private dialogRef: MatDialogRef<DebugWindowComponent>
  ) {}


  prettyJson(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    return JSON.stringify(value, null, 2);
  }


  getCount(value: any): number | null {
    if (Array.isArray(value)) {
      return value.length;
    }

    return null;
  }


  close(): void {
    this.dialogRef.close();
  }

}