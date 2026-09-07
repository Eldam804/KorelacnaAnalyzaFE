import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';

import * as d3 from 'd3';


/* ========================================================================== */
/* API DATA                                                                   */
/* ========================================================================== */

export interface NPtychApiData {
  nodes: string[];

  edges: Array<{
    source: string;
    target: string;
    correlation: number;
  }>;

  adjacency_matrix?: any[][];
  n?: number;
}


export interface PathApiData {
  /*
   * Pri cestách je poradie nodes dôležité.
   *
   * Napr.:
   * A -> B -> C -> D
   */
  nodes: string[];

  edges: Array<{
    source: string;
    target: string;
    correlation: number;
  }>;

  adjacency_matrix?: any[][];
}


export interface HotspotApiData {
  /*
   * Hotspot je indukovaná hviezda K_(1,h).
   *
   * Center môže backend poslať explicitne.
   * Ak ho neposiela, viewer ho spoľahlivo dopočíta
   * ako vrchol s najvyšším stupňom v štruktúre.
   */
  nodes: string[];

  edges: Array<{
    source: string;
    target: string;
    correlation: number;
  }>;

  adjacency_matrix?: any[][];

  center?: string;
  leaves?: string[];
  h?: number;
}


/* ========================================================================== */
/* INTERNAL DATA                                                              */
/* ========================================================================== */

type StructureKind = 'n-ptych' | 'path' | 'hotspot';


interface NormalizedEdge {
  source: string;
  target: string;
  correlation: number;
}


interface AnalysisStructure {
  key: string;
  kind: StructureKind;
  size: number;

  /*
   * N-ptych:
   *   members sú zoradené, pretože poradie vrcholov nehrá úlohu.
   *
   * Path:
   *   members zachovávajú poradie cesty.
   */
  members: string[];

  edges: NormalizedEdge[];

  /*
   * Iba pre hotspoty.
   * members[0] je tiež center, ale explicitné pole
   * nám zjednodušuje containment a detail render.
   */
  centerId?: string;
}


interface HierarchyViewNode {
  viewPathId: string;
  parentViewPathId: string | null;
  structure: AnalysisStructure | null;
  virtualRoot: boolean;
}


interface HierarchyDatasetState {
  allStructures: AnalysisStructure[];
  structureMap: Map<string, AnalysisStructure>;
  structuresBySize: Map<number, AnalysisStructure[]>;
  childrenCache: Map<string, AnalysisStructure[]>;
  rootStructures: AnalysisStructure[];

  expandedViewPaths: Set<string>;
  selectedViewPathId: string | null;

  transform: d3.ZoomTransform;
}


/* ========================================================================== */
/* DETAIL GRAPH                                                               */
/* ========================================================================== */

interface DetailNode extends d3.SimulationNodeDatum {
  id: string;
  lines: string[];
  boxHeight: number;

  /*
   * Používa sa hlavne pri paths, aby sa cesta držala horizontálne.
   */
  targetX?: number;
  targetY?: number;

  /*
   * Pri hotspote vizuálne odlíšime centrálny vrchol.
   */
  isCenter?: boolean;
}


interface DetailEdge extends d3.SimulationLinkDatum<DetailNode> {
  source: string | DetailNode;
  target: string | DetailNode;
  correlation: number;
}


/* ========================================================================== */
/* COMPONENT                                                                  */
/* ========================================================================== */

@Component({
  selector: 'app-graphs',
  templateUrl: './graphs.component.html',
  styleUrls: ['./graphs.component.css']
})
export class GraphsComponent
  implements AfterViewInit, OnChanges, OnDestroy {


  /* ======================================================================== */
  /* REFERENCES                                                               */
  /* ======================================================================== */

  @ViewChild('graphContainer')
  graphContainerRef!: ElementRef<HTMLDivElement>;


  @ViewChild('svg')
  svgRef!: ElementRef<SVGSVGElement>;


  /* ======================================================================== */
  /* INPUT                                                                    */
  /* ======================================================================== */

  @Input()
  nPtychsData: NPtychApiData[] | null = null;


  @Input()
  pathsData: PathApiData[] | null = null;


  @Input()
  hotspotsData: HotspotApiData[] | null = null;


  @Input()
  graphType: string = 'n-ptychs';


  /* ======================================================================== */
  /* CONFIGURATION                                                            */
  /* ======================================================================== */

  /*
   * N-ptych končí na K3.
   * K2 už v tomto view nepoužívame.
   */
  private readonly MIN_NPTYCH_SIZE = 3;


  /*
   * Cesta s dvoma vrcholmi je stále legitímna cesta.
   */
  private readonly MIN_PATH_SIZE = 2;


  /*
   * Najmenší hotspot je K_(1,2):
   * center + 2 leaves = 3 vrcholy.
   */
  private readonly MIN_HOTSPOT_SIZE = 3;


  private readonly CARD_WIDTH = 200;
  private readonly CARD_HEIGHT = 170;
  private readonly HORIZONTAL_SPACING = 245;
  private readonly VERTICAL_SPACING = 230;


  private readonly DETAIL_NODE_WIDTH = 190;
  private readonly ATTRIBUTE_LINE_LENGTH = 15;


  /* ======================================================================== */
  /* DATASETS                                                                 */
  /* ======================================================================== */

  private nPtychState: HierarchyDatasetState =
    this.createEmptyDatasetState();


  private pathState: HierarchyDatasetState =
    this.createEmptyDatasetState();


  private hotspotState: HierarchyDatasetState =
    this.createEmptyDatasetState();


  /* ======================================================================== */
  /* VIEW STATE                                                               */
  /* ======================================================================== */

  private viewMode: 'hierarchy' | 'detail' = 'hierarchy';


  private focusedStructure: AnalysisStructure | null = null;


  /*
   * Pri expand/collapse držíme kliknutú kartu na rovnakom mieste obrazovky.
   */
  private hierarchyAnchor: {
    graphType: string;
    viewPathId: string;
    screenX: number;
    screenY: number;
  } | null = null;


  /* ======================================================================== */
  /* ANGULAR / D3 STATE                                                       */
  /* ======================================================================== */

  private viewInitialized = false;
  private resizeObserver?: ResizeObserver;


  private detailTransform: d3.ZoomTransform = d3.zoomIdentity;


  private detailSimulation?: d3.Simulation<DetailNode, DetailEdge>;


  private clickTimer: number | null = null;


  /* ======================================================================== */
  /* PUBLIC TEMPLATE HELPERS                                                  */
  /* ======================================================================== */

  get hasActiveData(): boolean {
    const state = this.getActiveState();
    return state.allStructures.length > 0;
  }


  get emptyStateText(): string {
    if (this.graphType === 'paths') {
      return 'Nie sú dostupné cesty pre aktuálny dataset.';
    }

    if (this.graphType === 'hotspots') {
      return 'Nie sú dostupné hotspoty pre aktuálny dataset.';
    }

    return 'Nie sú dostupné N-ptychy pre aktuálny dataset.';
  }


  /* ======================================================================== */
  /* ANGULAR                                                                  */
  /* ======================================================================== */

  ngAfterViewInit(): void {
    this.viewInitialized = true;


    this.resizeObserver = new ResizeObserver(() => {
      if (this.viewMode === 'detail' && this.focusedStructure) {
        this.renderStructureDetail(
          this.focusedStructure,
          false
        );
        return;
      }


      if (this.hasActiveData) {
        this.renderHierarchy(false);
      }
    });


    this.resizeObserver.observe(
      this.graphContainerRef.nativeElement
    );


    if (this.nPtychsData?.length) {
      this.nPtychState = this.buildDatasetState(
        'n-ptych',
        this.nPtychsData
      );
    }


    if (this.pathsData?.length) {
      this.pathState = this.buildDatasetState(
        'path',
        this.pathsData
      );
    }


    if (this.hotspotsData?.length) {
      this.hotspotState = this.buildDatasetState(
        'hotspot',
        this.hotspotsData
      );
    }


    if (this.hasActiveData) {
      this.renderHierarchy(true);
    }
  }


  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewInitialized) {
      return;
    }


    let activeDatasetChanged = false;


    /* ====================================================================== */
    /* N-PTYCH DATA                                                           */
    /* ====================================================================== */

    if (changes['nPtychsData']) {
      this.nPtychState =
        this.nPtychsData?.length
          ? this.buildDatasetState(
              'n-ptych',
              this.nPtychsData
            )
          : this.createEmptyDatasetState();


      if (this.graphType === 'n-ptychs') {
        activeDatasetChanged = true;
      }
    }


    /* ====================================================================== */
    /* PATH DATA                                                              */
    /* ====================================================================== */

    if (changes['pathsData']) {
      this.pathState =
        this.pathsData?.length
          ? this.buildDatasetState(
              'path',
              this.pathsData
            )
          : this.createEmptyDatasetState();


      if (this.graphType === 'paths') {
        activeDatasetChanged = true;
      }
    }


    /* ====================================================================== */
    /* HOTSPOT DATA                                                           */
    /* ====================================================================== */

    if (changes['hotspotsData']) {
      this.hotspotState =
        this.hotspotsData?.length
          ? this.buildDatasetState(
              'hotspot',
              this.hotspotsData
            )
          : this.createEmptyDatasetState();


      if (this.graphType === 'hotspots') {
        activeDatasetChanged = true;
      }
    }


    /* ====================================================================== */
    /* TAB CHANGE                                                             */
    /* ====================================================================== */

    if (changes['graphType']) {
      this.detailSimulation?.stop();
      this.focusedStructure = null;
      this.viewMode = 'hierarchy';
      this.hierarchyAnchor = null;


      if (
        this.graphType !== 'n-ptychs' &&
        this.graphType !== 'paths' &&
        this.graphType !== 'hotspots'
      ) {
        this.clearSvg();
        return;
      }


      if (this.hasActiveData) {
        this.renderHierarchy(false);
      }
      else {
        this.clearSvg();
      }

      return;
    }


    /* ====================================================================== */
    /* ACTIVE DATA RELOADED                                                   */
    /* ====================================================================== */

    if (activeDatasetChanged) {
      this.detailSimulation?.stop();
      this.focusedStructure = null;
      this.viewMode = 'hierarchy';
      this.hierarchyAnchor = null;


      if (this.hasActiveData) {
        this.renderHierarchy(true);
      }
      else {
        this.clearSvg();
      }
    }
  }


  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.detailSimulation?.stop();
    this.cancelPendingClick();
  }


  /* ======================================================================== */
  /* DATASET BUILD                                                            */
  /* ======================================================================== */

  private createEmptyDatasetState(): HierarchyDatasetState {
    return {
      allStructures: [],
      structureMap: new Map<string, AnalysisStructure>(),
      structuresBySize: new Map<number, AnalysisStructure[]>(),
      childrenCache: new Map<string, AnalysisStructure[]>(),
      rootStructures: [],
      expandedViewPaths: new Set<string>(),
      selectedViewPathId: null,
      transform: d3.zoomIdentity
    };
  }


  private buildDatasetState(
    kind: StructureKind,
    apiData: Array<NPtychApiData | PathApiData | HotspotApiData>
  ): HierarchyDatasetState {

    console.time(
      kind === 'n-ptych'
        ? 'N-PTYCH HIERARCHY INITIALIZATION'
        : kind === 'path'
          ? 'PATH HIERARCHY INITIALIZATION'
          : 'HOTSPOT HIERARCHY INITIALIZATION'
    );


    const state = this.createEmptyDatasetState();


    const minimumSize = this.getMinimumSize(kind);


    for (const apiStructure of apiData) {
      const rawNodes = Array.from(
        new Set(apiStructure.nodes ?? [])
      );


      if (rawNodes.length < minimumSize) {
        continue;
      }


      const rawEdges: NormalizedEdge[] =
        (apiStructure.edges ?? [])
          .map(edge => ({
            source: this.getEndpointId(edge.source),
            target: this.getEndpointId(edge.target),
            correlation: edge.correlation
          }));


      let members: string[];
      let key: string;
      let centerId: string | undefined;


      if (kind === 'n-ptych') {
        members = [...rawNodes].sort();
        key = this.createNPtychKey(members);
      }
      else if (kind === 'path') {
        members = this.canonicalizePath(rawNodes);
        key = this.createPathKey(members);
      }
      else {
        const hotspotApi = apiStructure as HotspotApiData;


        centerId = this.resolveHotspotCenter(
          rawNodes,
          rawEdges,
          hotspotApi.center
        );


        if (!centerId) {
          continue;
        }


        const leaves = rawNodes
          .filter(node => node !== centerId)
          .sort();


        members = [
          centerId,
          ...leaves
        ];


        key = this.createHotspotKey(
          centerId,
          leaves
        );
      }


      if (state.structureMap.has(key)) {
        continue;
      }


      const memberSet = new Set(members);


      const edges = rawEdges.filter(edge =>
        memberSet.has(edge.source) &&
        memberSet.has(edge.target)
      );


      const structure: AnalysisStructure = {
        key,
        kind,
        size: members.length,
        members,
        edges,
        centerId
      };


      state.structureMap.set(key, structure);
      state.allStructures.push(structure);
    }



    state.allStructures.sort((a, b) => {
      if (a.size !== b.size) {
        return b.size - a.size;
      }

      return a.key.localeCompare(b.key);
    });


    for (const structure of state.allStructures) {
      if (!state.structuresBySize.has(structure.size)) {
        state.structuresBySize.set(structure.size, []);
      }

      state.structuresBySize
        .get(structure.size)
        ?.push(structure);
    }


    state.rootStructures = this.findRootStructures(state);


    /*
     * Rooty sú defaultne otvorené, aby bol hneď viditeľný prvý child level.
     */
    state.rootStructures.forEach((structure, index) => {
      state.expandedViewPaths.add(
        this.createRootViewPath(structure, index)
      );
    });


    if (state.rootStructures.length > 0) {
      state.selectedViewPathId = this.createRootViewPath(
        state.rootStructures[0],
        0
      );
    }


    console.log(
      kind === 'n-ptych'
        ? 'N-PTYCH LEVELS:'
        : kind === 'path'
          ? 'PATH LEVELS:'
          : 'HOTSPOT LEVELS:',
      Array.from(state.structuresBySize.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([size, structures]) => ({
          size,
          count: structures.length
        }))
    );


    console.log(
      kind === 'n-ptych'
        ? 'N-PTYCH ROOTS:'
        : kind === 'path'
          ? 'PATH ROOTS:'
          : 'HOTSPOT ROOTS:',
      state.rootStructures.length
    );


    console.timeEnd(
      kind === 'n-ptych'
        ? 'N-PTYCH HIERARCHY INITIALIZATION'
        : kind === 'path'
          ? 'PATH HIERARCHY INITIALIZATION'
          : 'HOTSPOT HIERARCHY INITIALIZATION'
    );


    return state;
  }


  /* ======================================================================== */
  /* ROOTS                                                                    */
  /* ======================================================================== */

  private findRootStructures(
    state: HierarchyDatasetState
  ): AnalysisStructure[] {

    const roots: AnalysisStructure[] = [];


    for (const structure of state.allStructures) {
      const possibleParents =
        state.structuresBySize.get(
          structure.size + 1
        ) ?? [];


      const hasParent = possibleParents.some(parent =>
        this.isDirectlyContained(
          structure,
          parent
        )
      );


      if (!hasParent) {
        roots.push(structure);
      }
    }


    return roots;
  }


  /* ======================================================================== */
  /* CHILDREN                                                                 */
  /* ======================================================================== */

  private getDirectChildren(
    parent: AnalysisStructure,
    state: HierarchyDatasetState
  ): AnalysisStructure[] {

    const minimumSize = this.getMinimumSize(parent.kind);


    if (parent.size <= minimumSize) {
      return [];
    }


    const cached = state.childrenCache.get(parent.key);

    if (cached) {
      return cached;
    }


    const childSize = parent.size - 1;

    if (childSize < minimumSize) {
      return [];
    }


    const candidates =
      state.structuresBySize.get(childSize) ?? [];


    const children = candidates
      .filter(child =>
        this.isDirectlyContained(
          child,
          parent
        )
      )
      .sort((a, b) =>
        a.key.localeCompare(b.key)
      );


    state.childrenCache.set(
      parent.key,
      children
    );


    return children;
  }


  private isDirectlyContained(
    child: AnalysisStructure,
    parent: AnalysisStructure
  ): boolean {

    if (child.kind !== parent.kind) {
      return false;
    }


    if (child.size !== parent.size - 1) {
      return false;
    }


    if (parent.kind === 'n-ptych') {
      return this.isSubset(
        child.members,
        parent.members
      );
    }


    if (parent.kind === 'path') {
      return this.isContiguousSubpath(
        child.members,
        parent.members
      );
    }


    return this.isNestedHotspot(
      child,
      parent
    );
  }


  /* ======================================================================== */
  /* PATH CONTAINMENT                                                         */
  /* ======================================================================== */

  /*
   * Príklad:
   *
   * parent:
   * A -> B -> C -> D -> E
   *
   * direct children:
   * A -> B -> C -> D
   * B -> C -> D -> E
   *
   * Reverz je považovaný za tú istú cestu.
   */
  private isContiguousSubpath(
    child: string[],
    parent: string[]
  ): boolean {

    if (child.length >= parent.length) {
      return false;
    }


    const childKey = this.createPathKey(child);


    for (
      let start = 0;
      start <= parent.length - child.length;
      start++
    ) {
      const slice = parent.slice(
        start,
        start + child.length
      );


      if (this.createPathKey(slice) === childKey) {
        return true;
      }
    }


    return false;
  }


  /* ======================================================================== */
  /* HOTSPOT CONTAINMENT                                                      */
  /* ======================================================================== */

  /*
   * Hotspot K_(1,h) je vnorený do väčšieho hotspotu iba vtedy,
   * keď majú rovnaký center a listy menšieho hotspotu sú podmnožinou
   * listov väčšieho hotspotu.
   *
   * Napr.:
   *
   * center A, leaves B C D E
   *                ↓
   * center A, leaves B C D
   */
  private isNestedHotspot(
    child: AnalysisStructure,
    parent: AnalysisStructure
  ): boolean {

    if (
      !child.centerId ||
      !parent.centerId ||
      child.centerId !== parent.centerId
    ) {
      return false;
    }


    const childLeaves = child.members.filter(
      member => member !== child.centerId
    );


    const parentLeaves = parent.members.filter(
      member => member !== parent.centerId
    );


    return this.isSubset(
      childLeaves,
      parentLeaves
    );
  }


  /* ======================================================================== */
  /* VISIBLE HIERARCHY                                                        */
  /* ======================================================================== */

  private buildVisibleHierarchy(): HierarchyViewNode {
    return {
      viewPathId: '__ROOT__',
      parentViewPathId: null,
      structure: null,
      virtualRoot: true
    };
  }


  private getVisibleChildren(
    node: HierarchyViewNode,
    state: HierarchyDatasetState
  ): HierarchyViewNode[] | undefined {

    if (node.virtualRoot) {
      return state.rootStructures.map(
        (structure, index) => ({
          viewPathId: this.createRootViewPath(
            structure,
            index
          ),
          parentViewPathId: '__ROOT__',
          structure,
          virtualRoot: false
        })
      );
    }


    if (!node.structure) {
      return undefined;
    }


    if (!state.expandedViewPaths.has(node.viewPathId)) {
      return undefined;
    }


    if (
      node.structure.size <=
      this.getMinimumSize(node.structure.kind)
    ) {
      return undefined;
    }


    const children = this.getDirectChildren(
      node.structure,
      state
    );


    if (children.length === 0) {
      return undefined;
    }


    return children.map(child => ({
      viewPathId:
        `${node.viewPathId}>${child.key}`,
      parentViewPathId:
        node.viewPathId,
      structure:
        child,
      virtualRoot:
        false
    }));
  }


  /* ======================================================================== */
  /* SINGLE CLICK                                                             */
  /* ======================================================================== */

  private handleNodeClick(
    hierarchyNode:
      d3.HierarchyPointNode<HierarchyViewNode>
  ): void {

    const node = hierarchyNode.data;
    const structure = node.structure;


    if (!structure) {
      return;
    }


    const state = this.getActiveState();


    /*
     * Zapamätáme si miesto kliknutej karty pred tým,
     * než d3.tree() prepočíta layout.
     */
    const hierarchyYOffset = this.VERTICAL_SPACING;


    this.hierarchyAnchor = {
      graphType: this.graphType,
      viewPathId: node.viewPathId,
      screenX: state.transform.applyX(
        hierarchyNode.x
      ),
      screenY: state.transform.applyY(
        hierarchyNode.y - hierarchyYOffset
      )
    };


    state.selectedViewPathId = node.viewPathId;


    /*
     * Posledný level už iba označíme.
     */
    if (
      structure.size <=
      this.getMinimumSize(structure.kind)
    ) {
      this.renderHierarchy(false);
      return;
    }


    /*
     * Root ostáva otvorený.
     * Klik naň iba zavrie hlbšie vetvy.
     */
    if (node.parentViewPathId === '__ROOT__') {
      this.collapseDescendants(
        node.viewPathId,
        state
      );

      state.expandedViewPaths.add(
        node.viewPathId
      );

      this.renderHierarchy(false);
      return;
    }


    const expanded =
      state.expandedViewPaths.has(
        node.viewPathId
      );


    if (expanded) {
      this.collapseViewPath(
        node.viewPathId,
        state
      );

      this.renderHierarchy(false);
      return;
    }


    this.collapseSiblingBranches(
      node,
      state
    );


    state.expandedViewPaths.add(
      node.viewPathId
    );


    this.renderHierarchy(false);
  }


  /* ======================================================================== */
  /* DOUBLE CLICK / DETAIL                                                    */
  /* ======================================================================== */

  private openStructureDetail(
    structure: AnalysisStructure
  ): void {

    this.hierarchyAnchor = null;
    this.cancelPendingClick();
    this.detailSimulation?.stop();


    this.focusedStructure = structure;
    this.viewMode = 'detail';
    this.detailTransform = d3.zoomIdentity;


    this.renderStructureDetail(
      structure,
      true
    );
  }


  private closeStructureDetail(): void {
    this.detailSimulation?.stop();


    this.focusedStructure = null;
    this.viewMode = 'hierarchy';
    this.hierarchyAnchor = null;


    /*
     * Pri návrate spravíme čistý fit hierarchie.
     */
    const state = this.getActiveState();
    state.transform = d3.zoomIdentity;


    this.renderHierarchy(true);
  }


  /* ======================================================================== */
  /* CLICK TIMER                                                              */
  /* ======================================================================== */

  private scheduleSingleClick(
    node:
      d3.HierarchyPointNode<HierarchyViewNode>
  ): void {

    this.cancelPendingClick();


    this.clickTimer = window.setTimeout(
      () => {
        this.clickTimer = null;
        this.handleNodeClick(node);
      },
      220
    );
  }


  private cancelPendingClick(): void {
    if (this.clickTimer !== null) {
      window.clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }


  /* ======================================================================== */
  /* COLLAPSE                                                                 */
  /* ======================================================================== */

  private collapseViewPath(
    viewPathId: string,
    state: HierarchyDatasetState
  ): void {

    for (
      const expandedPath
      of Array.from(state.expandedViewPaths)
    ) {
      if (
        expandedPath === viewPathId ||
        expandedPath.startsWith(
          `${viewPathId}>`
        )
      ) {
        state.expandedViewPaths.delete(
          expandedPath
        );
      }
    }
  }


  private collapseDescendants(
    viewPathId: string,
    state: HierarchyDatasetState
  ): void {

    for (
      const expandedPath
      of Array.from(state.expandedViewPaths)
    ) {
      if (
        expandedPath.startsWith(
          `${viewPathId}>`
        )
      ) {
        state.expandedViewPaths.delete(
          expandedPath
        );
      }
    }
  }


  private collapseSiblingBranches(
    node: HierarchyViewNode,
    state: HierarchyDatasetState
  ): void {

    if (!node.parentViewPathId) {
      return;
    }


    for (
      const expandedPath
      of Array.from(state.expandedViewPaths)
    ) {
      if (
        !expandedPath.startsWith(
          `${node.parentViewPathId}>`
        )
      ) {
        continue;
      }


      if (expandedPath === node.viewPathId) {
        continue;
      }


      const remaining = expandedPath.substring(
        node.parentViewPathId.length + 1
      );


      if (!remaining.includes('>')) {
        this.collapseViewPath(
          expandedPath,
          state
        );
      }
    }
  }


  /* ======================================================================== */
  /* HIERARCHY RENDER                                                         */
  /* ======================================================================== */

  private renderHierarchy(
    resetView: boolean
  ): void {

    if (
      !this.svgRef ||
      !this.graphContainerRef
    ) {
      return;
    }


    const state = this.getActiveState();


    if (state.allStructures.length === 0) {
      this.clearSvg();
      return;
    }


    this.detailSimulation?.stop();


    const container =
      this.graphContainerRef.nativeElement;


    const width = container.clientWidth;
    const height = container.clientHeight;


    if (width <= 0 || height <= 0) {
      return;
    }


    const svg = d3
      .select(this.svgRef.nativeElement)
      .attr('width', width)
      .attr('height', height)
      .attr(
        'viewBox',
        `0 0 ${width} ${height}`
      );


    svg.selectAll('*').remove();


    /* ====================================================================== */
    /* ARROW                                                                  */
    /* ====================================================================== */

    const defs = svg.append('defs');


    defs
      .append('marker')
      .attr('id', 'hierarchy-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#9ca3af');


    /* ====================================================================== */
    /* WORLD                                                                  */
    /* ====================================================================== */

    const world = svg
      .append('g')
      .attr('class', 'hierarchy-world')
      .attr(
        'transform',
        state.transform.toString()
      );


    const linksGroup = world
      .append('g')
      .attr('class', 'hierarchy-links');


    const nodesGroup = world
      .append('g')
      .attr('class', 'hierarchy-nodes');


    /* ====================================================================== */
    /* ZOOM                                                                   */
    /* ====================================================================== */

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 5])
      .filter((event: any) => {
        const target =
          event.target as Element | null;


        if (
          event.type === 'mousedown' &&
          target?.closest('.hierarchy-card')
        ) {
          return false;
        }


        return true;
      })
      .on('zoom', event => {
        state.transform = event.transform;

        world.attr(
          'transform',
          event.transform.toString()
        );
      });


    svg.call(zoomBehavior);


    /*
     * Synchronizuje aj interný D3 __zoom stav.
     */
    svg.call(
      zoomBehavior.transform,
      state.transform
    );


    svg.on('dblclick.zoom', null);


    /* ====================================================================== */
    /* TREE DATA                                                              */
    /* ====================================================================== */

    const hierarchyRoot =
      d3.hierarchy<HierarchyViewNode>(
        this.buildVisibleHierarchy(),
        node => this.getVisibleChildren(
          node,
          state
        )
      );


    const treeLayout =
      d3
        .tree<HierarchyViewNode>()
        .nodeSize([
          this.HORIZONTAL_SPACING,
          this.VERTICAL_SPACING
        ]);


    const pointRoot = treeLayout(
      hierarchyRoot
    );


    const visibleNodes = pointRoot
      .descendants()
      .filter(node =>
        !node.data.virtualRoot
      );


    const visibleLinks = pointRoot
      .links()
      .filter(link =>
        !link.source.data.virtualRoot &&
        !link.target.data.virtualRoot
      );


    const hierarchyYOffset =
      this.VERTICAL_SPACING;


    /* ====================================================================== */
    /* KEEP CLICKED CARD IN PLACE                                             */
    /* ====================================================================== */

    if (
      !resetView &&
      this.hierarchyAnchor &&
      this.hierarchyAnchor.graphType === this.graphType
    ) {
      const anchor = this.hierarchyAnchor;


      const anchorNode = visibleNodes.find(
        node =>
          node.data.viewPathId ===
          anchor.viewPathId
      );


      if (anchorNode) {
        const newWorldX = anchorNode.x;
        const newWorldY =
          anchorNode.y - hierarchyYOffset;


        const scale = state.transform.k;


        const translateX =
          anchor.screenX -
          newWorldX * scale;


        const translateY =
          anchor.screenY -
          newWorldY * scale;


        state.transform = d3.zoomIdentity
          .translate(
            translateX,
            translateY
          )
          .scale(scale);


        world.attr(
          'transform',
          state.transform.toString()
        );


        svg.call(
          zoomBehavior.transform,
          state.transform
        );
      }


      this.hierarchyAnchor = null;
    }


    /* ====================================================================== */
    /* LINKS                                                                  */
    /* ====================================================================== */

    linksGroup
      .selectAll<
        SVGPathElement,
        d3.HierarchyPointLink<HierarchyViewNode>
      >('path')
      .data(visibleLinks)
      .enter()
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', '#c7cbd4')
      .attr('stroke-width', 2)
      .attr(
        'marker-end',
        'url(#hierarchy-arrow)'
      )
      .attr('d', link => {
        const sourceX = link.source.x;
        const sourceY =
          link.source.y -
          hierarchyYOffset +
          this.CARD_HEIGHT / 2;


        const targetX = link.target.x;
        const targetY =
          link.target.y -
          hierarchyYOffset -
          this.CARD_HEIGHT / 2;


        const middleY =
          (sourceY + targetY) / 2;


        return `
          M ${sourceX} ${sourceY}
          C ${sourceX} ${middleY},
            ${targetX} ${middleY},
            ${targetX} ${targetY}
        `;
      });


    /* ====================================================================== */
    /* CARDS                                                                  */
    /* ====================================================================== */

    const cards = nodesGroup
      .selectAll<
        SVGGElement,
        d3.HierarchyPointNode<HierarchyViewNode>
      >('g.hierarchy-card')
      .data(
        visibleNodes,
        node => node.data.viewPathId
      )
      .enter()
      .append('g')
      .attr('class', 'hierarchy-card')
      .attr(
        'transform',
        node =>
          `translate(${node.x}, ${
            node.y - hierarchyYOffset
          })`
      )
      .style('cursor', 'pointer')
      .on('click', (event, node) => {
        event.stopPropagation();
        this.scheduleSingleClick(node);
      })
      .on('dblclick', (event, node) => {
        event.preventDefault();
        event.stopPropagation();


        this.cancelPendingClick();


        if (node.data.structure) {
          this.openStructureDetail(
            node.data.structure
          );
        }
      });


    /* ====================================================================== */
    /* CARD SHADOW                                                            */
    /* ====================================================================== */

    cards
      .append('rect')
      .attr(
        'x',
        -this.CARD_WIDTH / 2 + 3
      )
      .attr(
        'y',
        -this.CARD_HEIGHT / 2 + 4
      )
      .attr('width', this.CARD_WIDTH)
      .attr('height', this.CARD_HEIGHT)
      .attr('rx', 12)
      .attr(
        'fill',
        'rgba(0,0,0,0.06)'
      );


    /* ====================================================================== */
    /* CARD BACKGROUND                                                        */
    /* ====================================================================== */

    cards
      .append('rect')
      .attr(
        'x',
        -this.CARD_WIDTH / 2
      )
      .attr(
        'y',
        -this.CARD_HEIGHT / 2
      )
      .attr('width', this.CARD_WIDTH)
      .attr('height', this.CARD_HEIGHT)
      .attr('rx', 12)
      .attr('fill', node =>
        node.data.viewPathId ===
        state.selectedViewPathId
          ? '#eef2ff'
          : '#ffffff'
      )
      .attr('stroke', node =>
        node.data.viewPathId ===
        state.selectedViewPathId
          ? '#3f51b5'
          : '#d9dde5'
      )
      .attr('stroke-width', node =>
        node.data.viewPathId ===
        state.selectedViewPathId
          ? 2.5
          : 1.5
      );


    /* ====================================================================== */
    /* TITLE                                                                  */
    /* ====================================================================== */

    cards
      .append('text')
      .attr(
        'x',
        -this.CARD_WIDTH / 2 + 14
      )
      .attr(
        'y',
        -this.CARD_HEIGHT / 2 + 23
      )
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 15)
      .attr('font-weight', 700)
      .attr('fill', '#111827')
      .text(node =>
        node.data.structure
          ? this.getStructureTitle(
              node.data.structure
            )
          : ''
      );


    cards
      .append('text')
      .attr(
        'x',
        -this.CARD_WIDTH / 2 + 14
      )
      .attr(
        'y',
        -this.CARD_HEIGHT / 2 + 41
      )
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 10)
      .attr('fill', '#9ca3af')
      .text(node => {
        const structure = node.data.structure;

        if (!structure) {
          return '';
        }

        return this.getStructureStats(
          structure
        );
      });


    /* ====================================================================== */
    /* EXPAND INDICATOR                                                       */
    /* ====================================================================== */

    const expandable = cards.filter(node => {
      const structure = node.data.structure;

      if (!structure) {
        return false;
      }

      return this.getDirectChildren(
        structure,
        state
      ).length > 0;
    });


    expandable
      .append('circle')
      .attr(
        'cx',
        this.CARD_WIDTH / 2 - 20
      )
      .attr(
        'cy',
        -this.CARD_HEIGHT / 2 + 22
      )
      .attr('r', 11)
      .attr('fill', node =>
        state.expandedViewPaths.has(
          node.data.viewPathId
        )
          ? '#3f51b5'
          : '#eef2ff'
      )
      .attr('stroke', '#3f51b5');


    expandable
      .append('text')
      .attr(
        'x',
        this.CARD_WIDTH / 2 - 20
      )
      .attr(
        'y',
        -this.CARD_HEIGHT / 2 + 26
      )
      .attr('text-anchor', 'middle')
      .attr('font-size', 16)
      .attr('font-weight', 600)
      .attr('fill', node =>
        state.expandedViewPaths.has(
          node.data.viewPathId
        )
          ? '#ffffff'
          : '#3f51b5'
      )
      .text(node =>
        state.expandedViewPaths.has(
          node.data.viewPathId
        )
          ? '−'
          : '+'
      );


    /* ====================================================================== */
    /* MINI VISUALIZATION                                                     */
    /* ====================================================================== */

    cards.each((hierarchyNode, index, elements) => {
      const structure =
        hierarchyNode.data.structure;


      if (!structure) {
        return;
      }


      const card = d3.select<
        SVGGElement,
        unknown
      >(
        elements[index] as SVGGElement
      );


      if (structure.kind === 'path') {
        this.drawMiniPath(
          card,
          structure
        );
      }
      else if (structure.kind === 'hotspot') {
        this.drawMiniHotspot(
          card,
          structure
        );
      }
      else {
        this.drawMiniNPtych(
          card,
          structure
        );
      }
    });


    /* ====================================================================== */
    /* OPEN BUTTON                                                            */
    /* ====================================================================== */

    const openButtons = cards
      .append('g')
      .attr(
        'class',
        'open-structure-button'
      )
      .attr(
        'transform',
        `translate(${
          this.CARD_WIDTH / 2 - 48
        }, ${
          this.CARD_HEIGHT / 2 - 19
        })`
      )
      .style('cursor', 'pointer')
      .on('click', (event, node) => {
        event.stopPropagation();
        this.cancelPendingClick();


        if (node.data.structure) {
          this.openStructureDetail(
            node.data.structure
          );
        }
      });


    openButtons
      .append('rect')
      .attr('x', -36)
      .attr('y', -11)
      .attr('width', 72)
      .attr('height', 22)
      .attr('rx', 6)
      .attr('fill', '#eef2ff')
      .attr('stroke', '#c7cdf8');


    openButtons
      .append('text')
      .attr('x', 0)
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .attr('fill', '#3f51b5')
      .text('Otvoriť');


    /* ====================================================================== */
    /* MEMBERS                                                                */
    /* ====================================================================== */

    cards
      .append('text')
      .attr(
        'x',
        -this.CARD_WIDTH / 2 + 14
      )
      .attr(
        'y',
        this.CARD_HEIGHT / 2 - 14
      )
      .attr('text-anchor', 'start')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 9)
      .attr('fill', '#6b7280')
      .text(node =>
        this.formatMemberList(
          node.data.structure?.members ?? [],
          node.data.structure?.kind ?? 'n-ptych'
        )
      );


    cards
      .append('title')
      .text(node => {
        const structure = node.data.structure;

        if (!structure) {
          return '';
        }


        const separator =
          structure.kind === 'path'
            ? ' → '
            : structure.kind === 'hotspot'
              ? ' · '
              : ', ';


        return (
          `${this.getStructureTitle(structure)}\n` +
          structure.members.join(separator) +
          '\n\nDvojklikom otvor graf'
        );
      });


    /* ====================================================================== */
    /* HELP                                                                   */
    /* ====================================================================== */

    svg
      .append('text')
      .attr('x', 20)
      .attr('y', height - 20)
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 11)
      .attr('fill', '#9ca3af')
      .style('pointer-events', 'none')
      .text(
        'Klik = rozbaliť · Dvojklik = otvoriť graf · Koliesko = zoom · Drag pozadia = pohyb'
      );


    /* ====================================================================== */
    /* INITIAL FIT                                                            */
    /* ====================================================================== */

    if (
      resetView &&
      visibleNodes.length > 0
    ) {
      this.fitHierarchyToView(
        svg,
        zoomBehavior,
        visibleNodes,
        width,
        height,
        hierarchyYOffset,
        state
      );
    }
  }


  /* ======================================================================== */
  /* MINI N-PTYCH                                                             */
  /* ======================================================================== */

  private drawMiniNPtych(
    card: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >,
    structure: AnalysisStructure
  ): void {

    const graph = card
      .append('g')
      .attr('class', 'mini-graph');


    const centerX = 0;
    const centerY = 10;
    const radius = 30;


    const positions =
      new Map<string, { x: number; y: number }>();


    structure.members.forEach((member, index) => {
      const angle =
        (2 * Math.PI * index) /
        structure.members.length -
        Math.PI / 2;


      positions.set(member, {
        x:
          centerX +
          Math.cos(angle) * radius,
        y:
          centerY +
          Math.sin(angle) * radius
      });
    });


    graph
      .selectAll<SVGLineElement, NormalizedEdge>('line')
      .data(structure.edges)
      .enter()
      .append('line')
      .attr('x1', edge =>
        positions.get(edge.source)?.x ?? 0
      )
      .attr('y1', edge =>
        positions.get(edge.source)?.y ?? 0
      )
      .attr('x2', edge =>
        positions.get(edge.target)?.x ?? 0
      )
      .attr('y2', edge =>
        positions.get(edge.target)?.y ?? 0
      )
      .attr('stroke', edge =>
        edge.correlation >= 0
          ? '#6574d9'
          : '#d96b6b'
      )
      .attr('stroke-width', edge =>
        1 + Math.abs(edge.correlation) * 1.2
      )
      .attr('stroke-opacity', 0.75);


    graph
      .selectAll<SVGCircleElement, string>('circle')
      .data(structure.members)
      .enter()
      .append('circle')
      .attr('cx', member =>
        positions.get(member)?.x ?? 0
      )
      .attr('cy', member =>
        positions.get(member)?.y ?? 0
      )
      .attr('r', 6)
      .attr('fill', '#ffffff')
      .attr('stroke', '#3f51b5')
      .attr('stroke-width', 2);
  }


  /* ======================================================================== */
  /* MINI PATH                                                                */
  /* ======================================================================== */

  private drawMiniPath(
    card: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >,
    structure: AnalysisStructure
  ): void {

    const graph = card
      .append('g')
      .attr('class', 'mini-path');


    const centerY = 12;
    const availableWidth = 112;


    const count = structure.members.length;


    const spacing =
      count <= 1
        ? 0
        : availableWidth / (count - 1);


    const startX = -availableWidth / 2;


    const positions = new Map<
      string,
      { x: number; y: number }
    >();


    structure.members.forEach((member, index) => {
      positions.set(member, {
        x:
          count <= 1
            ? 0
            : startX + index * spacing,
        y: centerY
      });
    });


    structure.edges.forEach(edge => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);


      if (!source || !target) {
        return;
      }


      graph
        .append('line')
        .attr('x1', source.x)
        .attr('y1', source.y)
        .attr('x2', target.x)
        .attr('y2', target.y)
        .attr(
          'stroke',
          edge.correlation >= 0
            ? '#6574d9'
            : '#d96b6b'
        )
        .attr(
          'stroke-width',
          1 + Math.abs(edge.correlation) * 1.3
        )
        .attr('stroke-opacity', 0.8);
    });


    structure.members.forEach(member => {
      const position = positions.get(member);

      if (!position) {
        return;
      }


      graph
        .append('circle')
        .attr('cx', position.x)
        .attr('cy', position.y)
        .attr('r', 6)
        .attr('fill', '#ffffff')
        .attr('stroke', '#3f51b5')
        .attr('stroke-width', 2);
    });
  }


  /* ======================================================================== */
  /* MINI HOTSPOT                                                             */
  /* ======================================================================== */

  private drawMiniHotspot(
    card: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >,
    structure: AnalysisStructure
  ): void {

    const graph = card
      .append('g')
      .attr('class', 'mini-hotspot');


    const centerId = structure.centerId;


    if (!centerId) {
      return;
    }


    const leaves = structure.members.filter(
      member => member !== centerId
    );


    const center = {
      x: 0,
      y: 12
    };


    const radius = 36;


    const positions = new Map<
      string,
      { x: number; y: number }
    >();


    positions.set(
      centerId,
      center
    );


    leaves.forEach((leaf, index) => {
      const angle =
        (2 * Math.PI * index) /
        leaves.length -
        Math.PI / 2;


      positions.set(leaf, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    });


    structure.edges.forEach(edge => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);


      if (!source || !target) {
        return;
      }


      graph
        .append('line')
        .attr('x1', source.x)
        .attr('y1', source.y)
        .attr('x2', target.x)
        .attr('y2', target.y)
        .attr(
          'stroke',
          edge.correlation >= 0
            ? '#6574d9'
            : '#d96b6b'
        )
        .attr(
          'stroke-width',
          1 + Math.abs(edge.correlation) * 1.3
        )
        .attr('stroke-opacity', 0.8);
    });


    leaves.forEach(leaf => {
      const position = positions.get(leaf);


      if (!position) {
        return;
      }


      graph
        .append('circle')
        .attr('cx', position.x)
        .attr('cy', position.y)
        .attr('r', 5.5)
        .attr('fill', '#ffffff')
        .attr('stroke', '#6574d9')
        .attr('stroke-width', 1.8);
    });


    graph
      .append('circle')
      .attr('cx', center.x)
      .attr('cy', center.y)
      .attr('r', 8)
      .attr('fill', '#eef2ff')
      .attr('stroke', '#3f51b5')
      .attr('stroke-width', 2.4);
  }


  /* ======================================================================== */
  /* DETAIL VIEW                                                              */
  /* ======================================================================== */

  private renderStructureDetail(
    structure: AnalysisStructure,
    resetView: boolean
  ): void {

    if (
      !this.svgRef ||
      !this.graphContainerRef
    ) {
      return;
    }


    this.detailSimulation?.stop();


    const container =
      this.graphContainerRef.nativeElement;


    const width = container.clientWidth;
    const height = container.clientHeight;


    if (width <= 0 || height <= 0) {
      return;
    }


    if (resetView) {
      this.detailTransform = d3.zoomIdentity;
    }


    const svg = d3
      .select(this.svgRef.nativeElement)
      .attr('width', width)
      .attr('height', height)
      .attr(
        'viewBox',
        `0 0 ${width} ${height}`
      );


    svg.selectAll('*').remove();


    /* ====================================================================== */
    /* INITIAL NODE POSITIONS                                                 */
    /* ====================================================================== */

    const centerX = width / 2;
    const centerY = height / 2;


    const nodes: DetailNode[] =
      structure.members.map((member, index) => {
        const lines = this.wrapAttributeLabel(
          member,
          this.ATTRIBUTE_LINE_LENGTH
        );


        const boxHeight = Math.max(
          64,
          30 + lines.length * 18
        );


        if (structure.kind === 'path') {
          const desiredSpacing = 225;

          const pathWidth =
            (structure.members.length - 1) *
            desiredSpacing;


          const x =
            centerX - pathWidth / 2 +
            index * desiredSpacing;


          return {
            id: member,
            lines,
            boxHeight,
            x,
            y: centerY,
            targetX: x,
            targetY: centerY
          };
        }


        if (structure.kind === 'hotspot') {
          const centerId = structure.centerId;
          const isCenter = member === centerId;


          if (isCenter) {
            return {
              id: member,
              lines,
              boxHeight,
              x: centerX,
              y: centerY,
              targetX: centerX,
              targetY: centerY,
              isCenter: true
            };
          }


          const leaves = structure.members.filter(
            value => value !== centerId
          );


          const leafIndex = leaves.indexOf(member);


          const hotspotRadius = Math.max(
            210,
            leaves.length * 52
          );


          const angle =
            (2 * Math.PI * leafIndex) /
            leaves.length -
            Math.PI / 2;


          const x =
            centerX +
            Math.cos(angle) * hotspotRadius;


          const y =
            centerY +
            Math.sin(angle) * hotspotRadius;


          return {
            id: member,
            lines,
            boxHeight,
            x,
            y,
            targetX: x,
            targetY: y,
            isCenter: false
          };
        }


        const initialRadius = Math.max(
          140,
          structure.size * 38
        );


        const angle =
          (2 * Math.PI * index) /
          structure.members.length -
          Math.PI / 2;


        return {
          id: member,
          lines,
          boxHeight,
          x:
            centerX +
            Math.cos(angle) * initialRadius,
          y:
            centerY +
            Math.sin(angle) * initialRadius
        };
      });


    const edges: DetailEdge[] =
      structure.edges.map(edge => ({
        source: edge.source,
        target: edge.target,
        correlation: edge.correlation
      }));


    /* ====================================================================== */
    /* WORLD                                                                  */
    /* ====================================================================== */

    const world = svg
      .append('g')
      .attr('class', 'detail-world')
      .attr(
        'transform',
        this.detailTransform.toString()
      );


    const linksGroup = world
      .append('g')
      .attr('class', 'detail-links');


    const labelsGroup = world
      .append('g')
      .attr('class', 'detail-edge-labels');


    const nodesGroup = world
      .append('g')
      .attr('class', 'detail-nodes');


    /* ====================================================================== */
    /* ZOOM                                                                   */
    /* ====================================================================== */

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 6])
      .filter((event: any) => {
        const target =
          event.target as Element | null;


        if (
          event.type === 'mousedown' &&
          target?.closest('.detail-node')
        ) {
          return false;
        }


        return true;
      })
      .on('zoom', event => {
        this.detailTransform = event.transform;

        world.attr(
          'transform',
          event.transform.toString()
        );
      });


    svg.call(zoomBehavior);


    /*
     * Resetuje/synchronizuje interný D3 zoom stav medzi hierarchy/detail view.
     */
    svg.call(
      zoomBehavior.transform,
      this.detailTransform
    );


    svg.on('dblclick.zoom', null);


    /* ====================================================================== */
    /* EDGES                                                                  */
    /* ====================================================================== */

    const links = linksGroup
      .selectAll<SVGLineElement, DetailEdge>('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('stroke', edge =>
        edge.correlation >= 0
          ? '#596bd8'
          : '#d45f5f'
      )
      .attr('stroke-width', edge =>
        2 + Math.abs(edge.correlation) * 2
      )
      .attr('stroke-opacity', 0.72);


    /* ====================================================================== */
    /* EDGE LABELS                                                            */
    /* ====================================================================== */

    const edgeLabels = labelsGroup
      .selectAll<SVGTextElement, DetailEdge>('text')
      .data(edges)
      .enter()
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr(
        'font-family',
        'JetBrains Mono, Consolas, monospace'
      )
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .attr('fill', '#4b5563')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 5)
      .attr('stroke-linejoin', 'round')
      .text(edge =>
        edge.correlation.toFixed(2)
      );


    /* ====================================================================== */
    /* RECTANGULAR NODES                                                      */
    /* ====================================================================== */

    const nodeGroups = nodesGroup
      .selectAll<SVGGElement, DetailNode>(
        'g.detail-node'
      )
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'detail-node')
      .style('cursor', 'grab');


    nodeGroups
      .append('rect')
      .attr(
        'x',
        -this.DETAIL_NODE_WIDTH / 2 + 3
      )
      .attr('y', node =>
        -node.boxHeight / 2 + 4
      )
      .attr('width', this.DETAIL_NODE_WIDTH)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr(
        'fill',
        'rgba(0,0,0,0.08)'
      );


    nodeGroups
      .append('rect')
      .attr(
        'x',
        -this.DETAIL_NODE_WIDTH / 2
      )
      .attr('y', node =>
        -node.boxHeight / 2
      )
      .attr('width', this.DETAIL_NODE_WIDTH)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr('fill', node =>
        node.isCenter
          ? '#eef2ff'
          : '#ffffff'
      )
      .attr('stroke', node =>
        node.isCenter
          ? '#3f51b5'
          : '#6574d9'
      )
      .attr('stroke-width', node =>
        node.isCenter
          ? 3
          : 2.5
      );


    nodeGroups.each((node, index, elements) => {
      const group = d3.select<
        SVGGElement,
        unknown
      >(
        elements[index] as SVGGElement
      );


      const text = group
        .append('text')
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 13)
        .attr('font-weight', 600)
        .attr('fill', '#1f2937');


      const lineHeight = 18;


      const totalHeight =
        (node.lines.length - 1) *
        lineHeight;


      node.lines.forEach((line, lineIndex) => {
        text
          .append('tspan')
          .attr('x', 0)
          .attr(
            'y',
            lineIndex * lineHeight -
            totalHeight / 2 +
            4
          )
          .text(line);
      });
    });


    /* ====================================================================== */
    /* SIMULATION                                                             */
    /* ====================================================================== */

    const simulation = d3
      .forceSimulation<DetailNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<DetailNode, DetailEdge>(edges)
          .id(node => node.id)
          .distance(
            structure.kind === 'path'
              ? 225
              : structure.kind === 'hotspot'
                ? 230
                : 240
          )
          .strength(
            structure.kind === 'path'
              ? 0.85
              : structure.kind === 'hotspot'
                ? 0.9
                : 0.6
          )
      )
      .force(
        'charge',
        d3
          .forceManyBody()
          .strength(
            structure.kind === 'path'
              ? -300
              : structure.kind === 'hotspot'
                ? -500
                : -900
          )
      )
      .force(
        'collision',
        d3
          .forceCollide<DetailNode>()
          .radius(node => {
            const halfWidth =
              this.DETAIL_NODE_WIDTH / 2;


            const halfHeight =
              node.boxHeight / 2;


            return (
              Math.sqrt(
                halfWidth * halfWidth +
                halfHeight * halfHeight
              ) +
              25
            );
          })
      );


    if (structure.kind === 'path') {
      /*
       * Cesta sa drží ako reálna sekvencia zľava doprava.
       */
      simulation
        .force(
          'x',
          d3
            .forceX<DetailNode>(
              node => node.targetX ?? centerX
            )
            .strength(0.35)
        )
        .force(
          'y',
          d3
            .forceY<DetailNode>(
              node => node.targetY ?? centerY
            )
            .strength(0.45)
        );
    }
    else if (structure.kind === 'hotspot') {
      /*
       * Hotspot držíme ako hviezdu:
       * center v strede, leaves na kružnici okolo neho.
       */
      simulation
        .force(
          'x',
          d3
            .forceX<DetailNode>(
              node => node.targetX ?? centerX
            )
            .strength(node =>
              node.isCenter
                ? 0.6
                : 0.24
            )
        )
        .force(
          'y',
          d3
            .forceY<DetailNode>(
              node => node.targetY ?? centerY
            )
            .strength(node =>
              node.isCenter
                ? 0.6
                : 0.24
            )
        );
    }
    else {
      simulation
        .force(
          'center',
          d3.forceCenter(
            centerX,
            centerY
          )
        )
        .force(
          'x',
          d3
            .forceX<DetailNode>(centerX)
            .strength(0.035)
        )
        .force(
          'y',
          d3
            .forceY<DetailNode>(centerY)
            .strength(0.035)
        );
    }


    this.detailSimulation = simulation;


    /* ====================================================================== */
    /* DRAG                                                                   */
    /* ====================================================================== */

    const dragBehavior = d3
      .drag<SVGGElement, DetailNode>()
      .on('start', (event, node) => {
        if (!event.active) {
          this.detailSimulation
            ?.alphaTarget(0.3)
            .restart();
        }


        node.fx = node.x;
        node.fy = node.y;
      })
      .on('drag', (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on('end', (event, node) => {
        if (!event.active) {
          this.detailSimulation
            ?.alphaTarget(0);
        }


        node.fx = null;
        node.fy = null;
      });


    nodeGroups.call(dragBehavior);


    /* ====================================================================== */
    /* TICK                                                                   */
    /* ====================================================================== */

    this.detailSimulation.on('tick', () => {
      links
        .attr('x1', edge =>
          (edge.source as DetailNode).x ?? 0
        )
        .attr('y1', edge =>
          (edge.source as DetailNode).y ?? 0
        )
        .attr('x2', edge =>
          (edge.target as DetailNode).x ?? 0
        )
        .attr('y2', edge =>
          (edge.target as DetailNode).y ?? 0
        );


      edgeLabels
        .attr('x', edge => {
          const source =
            edge.source as DetailNode;

          const target =
            edge.target as DetailNode;


          return (
            ((source.x ?? 0) +
            (target.x ?? 0)) /
            2
          );
        })
        .attr('y', edge => {
          const source =
            edge.source as DetailNode;

          const target =
            edge.target as DetailNode;


          return (
            ((source.y ?? 0) +
            (target.y ?? 0)) /
            2
          );
        });


      nodeGroups.attr(
        'transform',
        node =>
          `translate(${node.x ?? 0}, ${
            node.y ?? 0
          })`
      );
    });


    /* ====================================================================== */
    /* DETAIL HEADER                                                          */
    /* ====================================================================== */

    this.drawDetailControls(
      svg,
      structure,
      width
    );
  }


  /* ======================================================================== */
  /* DETAIL CONTROLS                                                          */
  /* ======================================================================== */

  private drawDetailControls(
    svg: d3.Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >,
    structure: AnalysisStructure,
    width: number
  ): void {

    const controls = svg
      .append('g')
      .attr('class', 'detail-controls');


    const backButton = controls
      .append('g')
      .attr(
        'transform',
        'translate(24, 26)'
      )
      .style('cursor', 'pointer')
      .on('click', event => {
        event.stopPropagation();
        this.closeStructureDetail();
      });


    backButton
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', 118)
      .attr('height', 36)
      .attr('rx', 8)
      .attr('fill', '#ffffff')
      .attr('stroke', '#d1d5db');


    backButton
      .append('text')
      .attr('x', 59)
      .attr('y', 23)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('fill', '#374151')
      .text('← Hierarchia');


    controls
      .append('text')
      .attr('x', width / 2)
      .attr('y', 38)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 20)
      .attr('font-weight', 700)
      .attr('fill', '#111827')
      .text(
        this.getStructureTitle(structure)
      );


    controls
      .append('text')
      .attr('x', width / 2)
      .attr('y', 56)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 11)
      .attr('fill', '#6b7280')
      .text(
        this.getStructureStats(
          structure
        )
      );
  }


  /* ======================================================================== */
  /* FIT                                                                      */
  /* ======================================================================== */

  private fitHierarchyToView(
    svg: d3.Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >,
    zoomBehavior: d3.ZoomBehavior<
      SVGSVGElement,
      unknown
    >,
    nodes: d3.HierarchyPointNode<
      HierarchyViewNode
    >[],
    width: number,
    height: number,
    yOffset: number,
    state: HierarchyDatasetState
  ): void {

    if (nodes.length === 0) {
      return;
    }


    const xValues = nodes.map(node => node.x);
    const yValues = nodes.map(
      node => node.y - yOffset
    );


    const minX =
      Math.min(...xValues) -
      this.CARD_WIDTH / 2;


    const maxX =
      Math.max(...xValues) +
      this.CARD_WIDTH / 2;


    const minY =
      Math.min(...yValues) -
      this.CARD_HEIGHT / 2;


    const maxY =
      Math.max(...yValues) +
      this.CARD_HEIGHT / 2;


    const hierarchyWidth = Math.max(
      1,
      maxX - minX
    );


    const hierarchyHeight = Math.max(
      1,
      maxY - minY
    );


    const padding = 100;


    const scaleX =
      (width - padding) /
      hierarchyWidth;


    const scaleY =
      (height - padding) /
      hierarchyHeight;


    const scale = Math.max(
      0.3,
      Math.min(
        1,
        scaleX,
        scaleY
      )
    );


    const centerX =
      (minX + maxX) / 2;


    const centerY =
      (minY + maxY) / 2;


    const transform = d3.zoomIdentity
      .translate(
        width / 2,
        height / 2
      )
      .scale(scale)
      .translate(
        -centerX,
        -centerY
      );


    state.transform = transform;


    svg.call(
      zoomBehavior.transform,
      transform
    );
  }


  /* ======================================================================== */
  /* LABEL WRAP                                                               */
  /* ======================================================================== */

  private wrapAttributeLabel(
    value: string,
    maxLength: number
  ): string[] {

    if (value.length <= maxLength) {
      return [value];
    }


    const lines: string[] = [];
    let remaining = value;


    while (remaining.length > maxLength) {
      let splitIndex = maxLength;


      for (
        let index = maxLength - 1;
        index >= Math.floor(maxLength / 2);
        index--
      ) {
        const char = remaining[index];


        if (
          char === '_' ||
          char === '-' ||
          char === ' '
        ) {
          splitIndex = index + 1;
          break;
        }
      }


      const line = remaining
        .substring(0, splitIndex)
        .trim();


      if (line.length > 0) {
        lines.push(line);
      }


      remaining = remaining
        .substring(splitIndex)
        .trim();
    }


    if (remaining.length > 0) {
      lines.push(remaining);
    }


    return lines;
  }


  /* ======================================================================== */
  /* HELPERS                                                                  */
  /* ======================================================================== */

  private getActiveState(): HierarchyDatasetState {
    if (this.graphType === 'paths') {
      return this.pathState;
    }


    if (this.graphType === 'hotspots') {
      return this.hotspotState;
    }


    return this.nPtychState;
  }


  private getMinimumSize(
    kind: StructureKind
  ): number {
    if (kind === 'path') {
      return this.MIN_PATH_SIZE;
    }


    if (kind === 'hotspot') {
      return this.MIN_HOTSPOT_SIZE;
    }


    return this.MIN_NPTYCH_SIZE;
  }


  private getStructureTitle(
    structure: AnalysisStructure
  ): string {
    if (structure.kind === 'path') {
      return `Cesta ${structure.size}`;
    }


    if (structure.kind === 'hotspot') {
      return `Hotspot H${Math.max(0, structure.size - 1)}`;
    }


    return `K${structure.size}`;
  }


  private getStructureStats(
    structure: AnalysisStructure
  ): string {
    if (structure.kind === 'hotspot') {
      return (
        `${Math.max(0, structure.size - 1)} listov · ` +
        `${structure.edges.length} hrán`
      );
    }


    return (
      `${structure.size} vrcholov · ` +
      `${structure.edges.length} hrán`
    );
  }


  private resolveHotspotCenter(
    nodes: string[],
    edges: NormalizedEdge[],
    explicitCenter?: string
  ): string | undefined {

    if (
      explicitCenter &&
      nodes.includes(explicitCenter)
    ) {
      return explicitCenter;
    }


    const degree = new Map<string, number>();


    nodes.forEach(node =>
      degree.set(node, 0)
    );


    edges.forEach(edge => {
      if (degree.has(edge.source)) {
        degree.set(
          edge.source,
          (degree.get(edge.source) ?? 0) + 1
        );
      }


      if (degree.has(edge.target)) {
        degree.set(
          edge.target,
          (degree.get(edge.target) ?? 0) + 1
        );
      }
    });


    let center: string | undefined;
    let highestDegree = -1;


    for (const node of nodes) {
      const nodeDegree = degree.get(node) ?? 0;


      if (nodeDegree > highestDegree) {
        center = node;
        highestDegree = nodeDegree;
      }
    }


    return center;
  }


  private createHotspotKey(
    center: string,
    leaves: string[]
  ): string {
    return (
      `${center}::` +
      [...leaves]
        .sort()
        .join('|')
    );
  }


  private createNPtychKey(
    members: string[]
  ): string {
    return [...members]
      .sort()
      .join('|');
  }


  private canonicalizePath(
    nodes: string[]
  ): string[] {
    const forward = [...nodes];
    const reverse = [...nodes].reverse();


    const forwardKey = forward.join('→');
    const reverseKey = reverse.join('→');


    return forwardKey.localeCompare(reverseKey) <= 0
      ? forward
      : reverse;
  }


  private createPathKey(
    nodes: string[]
  ): string {
    return this.canonicalizePath(nodes)
      .join('→');
  }


  private createRootViewPath(
    structure: AnalysisStructure,
    index: number
  ): string {
    return (
      `ROOT-${structure.kind}-${index}-` +
      structure.key
    );
  }


  private isSubset(
    smaller: string[],
    larger: string[]
  ): boolean {

    if (smaller.length >= larger.length) {
      return false;
    }


    const largerSet = new Set(larger);


    return smaller.every(member =>
      largerSet.has(member)
    );
  }


  private getEndpointId(
    endpoint:
      string |
      {
        id?: string;
      }
  ): string {

    if (typeof endpoint === 'string') {
      return endpoint;
    }


    return endpoint?.id ?? '';
  }


  private formatMemberList(
    members: string[],
    kind: StructureKind
  ): string {

    let value: string;


    if (kind === 'path') {
      value = members.join(' → ');
    }
    else if (kind === 'hotspot') {
      const [center, ...leaves] = members;

      value = center
        ? `${center} → ${leaves.join(', ')}`
        : '';
    }
    else {
      value = members.join(' · ');
    }
    const maximumLength = 24;


    if (value.length <= maximumLength) {
      return value;
    }


    return (
      value.substring(
        0,
        maximumLength - 3
      ) +
      '...'
    );
  }


  /* ======================================================================== */
  /* CLEAR                                                                    */
  /* ======================================================================== */

  private clearSvg(): void {
    this.detailSimulation?.stop();


    if (!this.svgRef) {
      return;
    }


    d3
      .select(this.svgRef.nativeElement)
      .selectAll('*')
      .remove();
  }


  /* ======================================================================== */
  /* RESET VIEW                                                               */
  /* ======================================================================== */

  public resetView(): void {
    if (
      this.viewMode === 'detail' &&
      this.focusedStructure
    ) {
      this.detailTransform = d3.zoomIdentity;


      this.renderStructureDetail(
        this.focusedStructure,
        true
      );

      return;
    }


    const state = this.getActiveState();
    state.transform = d3.zoomIdentity;
    this.hierarchyAnchor = null;


    if (state.allStructures.length > 0) {
      this.renderHierarchy(true);
    }
  }
}
