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
  get totalSubstructureAmount(): number {
  return (
    (this.data.nPtychs?.length ?? 0) +
    (this.data.hotspots?.length ?? 0)
  );
}

get nPtychAmount(): number {
  return this.data.nPtychs?.length ?? 0;
}

get hotspotAmount(): number {
  return this.data.hotspots?.length ?? 0;
}

get nPtychAmountsBySize(): Array<{
  size: number;
  amount: number;
}> {

  const counts = new Map<number, number>();

  for (const nPtych of this.data.nPtychs ?? []) {

    const size =
      Number(
        nPtych?.n ??
        nPtych?.nodes?.length ??
        0
      );

    if (size <= 0) {
      continue;
    }

    counts.set(
      size,
      (counts.get(size) ?? 0) + 1
    );
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([size, amount]) => ({
      size,
      amount
    }));
}

get hotspotAmountsBySize(): Array<{
  h: number;
  amount: number;
}> {

  const counts = new Map<number, number>();

  for (const hotspot of this.data.hotspots ?? []) {

    const h =
      Number(
        hotspot?.h ??
        hotspot?.leaves?.length ??
        (
          Array.isArray(hotspot?.nodes)
            ? hotspot.nodes.length - 1
            : 0
        )
      );

    if (h <= 0) {
      continue;
    }

    counts.set(
      h,
      (counts.get(h) ?? 0) + 1
    );
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([h, amount]) => ({
      h,
      amount
    }));
}


  close(): void {
    this.dialogRef.close();
  }

}