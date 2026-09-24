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

export interface GraphApiData {
  nodes: Array<string | { id?: string }>;
  edges: Array<{
    source: string | { id?: string };
    target: string | { id?: string };
    correlation: number;
  }>;
  adjacency_matrix?: any;
}

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

export interface HotspotApiData {
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

type StructureKind = 'n-ptych' | 'hotspot';

interface NormalizedEdge {
  source: string;
  target: string;
  correlation: number;
}

interface AnalysisStructure {
  key: string;
  kind: StructureKind;
  size: number;
  members: string[];
  edges: NormalizedEdge[];
  centerId?: string;
  displayTitle?: string;
  displayStats?: string;
}

interface HierarchyViewNode {
  viewPathId: string;
  parentViewPathId: string | null;
  structure: AnalysisStructure | null;
  virtualRoot: boolean;
  aggregateKind?: 'hotspot-h2';
  aggregateStructures?: AnalysisStructure[];
}

interface HierarchyDatasetState {
  allStructures: AnalysisStructure[];
  structureMap: Map<string, AnalysisStructure>;
  structuresBySize: Map<number, AnalysisStructure[]>;
  childrenCache: Map<string, AnalysisStructure[]>;
  rootStructures: AnalysisStructure[];
  expandedViewPaths: Set<string>;
  selectedViewPathId: string | null;
}

interface RenderedHierarchyNode {
  side: StructureKind;
  hierarchyNode: d3.HierarchyPointNode<HierarchyViewNode>;
  x: number;
  y: number;
}

interface RenderedHierarchyLink {
  side: StructureKind;
  source: RenderedHierarchyNode | null;
  target: RenderedHierarchyNode;
}

interface HierarchyRenderData {
  nodes: RenderedHierarchyNode[];
  links: RenderedHierarchyLink[];
}

interface DetailNode extends d3.SimulationNodeDatum {
  id: string;
  lines: string[];
  boxHeight: number;
  targetX?: number;
  targetY?: number;
  isCenter?: boolean;
}

interface DetailEdge extends d3.SimulationLinkDatum<DetailNode> {
  source: string | DetailNode;
  target: string | DetailNode;
  correlation: number;
}

interface MainGraphNode extends d3.SimulationNodeDatum {
  id: string;
  lines: string[];
  boxHeight: number;
}

interface MainGraphEdge extends d3.SimulationLinkDatum<MainGraphNode> {
  source: string | MainGraphNode;
  target: string | MainGraphNode;
  correlation: number;
}

@Component({
  selector: 'app-graphs',
  templateUrl: './graphs.component.html',
  styleUrls: ['./graphs.component.css']
})
export class GraphsComponent
  implements AfterViewInit, OnChanges, OnDestroy {

  @ViewChild('graphContainer')
  graphContainerRef!: ElementRef<HTMLDivElement>;

  @ViewChild('svg')
  svgRef!: ElementRef<SVGSVGElement>;

  @Input()
  graphData: GraphApiData | null = null;

  @Input()
  nPtychsData: NPtychApiData[] | null = null;

  @Input()
  hotspotsData: HotspotApiData[] | null = null;

  private readonly MIN_NPTYCH_SIZE = 3;
  private readonly MIN_HOTSPOT_SIZE = 3;
  private readonly CARD_WIDTH = 220;
  private readonly CARD_HEIGHT = 220;
  private readonly HORIZONTAL_SPACING = 270;
  private readonly DEEP_HIERARCHY_HORIZONTAL_FACTOR = 0.88;
  private readonly CROSS_BRANCH_HORIZONTAL_FACTOR = 0.62;
  private readonly VERTICAL_SPACING = 280;
  private readonly HOTSPOT_H2_GROUP_THRESHOLD = 20;
  private readonly HOTSPOT_H2_GROUP_PATH = '__HOTSPOT_H2_GROUP__';
  private readonly HOTSPOT_H2_GROUP_HORIZONTAL_GAP = 420;
  private readonly MAIN_GRAPH_MIN_WIDTH = 900;
  private readonly MAIN_GRAPH_MIN_HEIGHT = 560;
  private readonly MAIN_GRAPH_MAX_WIDTH = 12000;
  private readonly MAIN_GRAPH_MAX_HEIGHT = 9000;
  private readonly MAIN_GRAPH_NODE_WIDTH = 170;
  private readonly MAIN_GRAPH_TOP_PADDING = 92;
  private readonly MAIN_GRAPH_SIDE_PADDING = 125;
  private readonly MAIN_GRAPH_HORIZONTAL_SPREAD = 620;
  private readonly MAIN_GRAPH_VERTICAL_SPREAD = 520;
  private readonly MAIN_GRAPH_COLLISION_PADDING = 285;
  private readonly MAIN_GRAPH_FA2_ITERATIONS = 2200;
  private readonly MAIN_GRAPH_FA2_REPULSION = 72000;
  private readonly MAIN_GRAPH_FA2_ATTRACTION = 0.016;
  private readonly MAIN_GRAPH_FA2_EDGE_LENGTH = 520;
  private readonly MAIN_GRAPH_FA2_GRAVITY = 0.0011;
  private readonly MAIN_GRAPH_FA2_INITIAL_STEP = 42;
  private readonly MAIN_GRAPH_FA2_FINAL_STEP = 2.5;
  private readonly MAIN_GRAPH_UNIFORM_SPREAD_PASSES = 260;
  private readonly MAIN_GRAPH_UNIFORM_SPREAD_FACTOR = 0.92;
  private readonly MAIN_GRAPH_RECTANGLE_PADDING = 34;
  private readonly MAIN_GRAPH_FINAL_FILL = 0.985;
  private readonly MAIN_GRAPH_BOX_SCALE = 0.88;
  private readonly MAIN_GRAPH_EDGE_SAFETY = 58;
  private readonly GRAPH_BRANCH_GAP = 120;
  private readonly DETAIL_NODE_WIDTH = 170;
  private readonly ATTRIBUTE_LINE_LENGTH = 15;

  private nPtychState: HierarchyDatasetState =
    this.createEmptyDatasetState();

  private hotspotState: HierarchyDatasetState =
    this.createEmptyDatasetState();

  private viewMode: 'combined' | 'detail' = 'combined';
  private focusedStructure: AnalysisStructure | null = null;

  private hierarchyAnchor: {
    side: StructureKind;
    viewPathId: string;
    screenX: number;
    screenY: number;
  } | null = null;

  private viewInitialized = false;
  private resizeObserver?: ResizeObserver;
  private viewTransform: d3.ZoomTransform = d3.zoomIdentity;
  private combinedTransformBeforeDetail: d3.ZoomTransform | null = null;
  private detailTransform: d3.ZoomTransform = d3.zoomIdentity;
  private detailSimulation?: d3.Simulation<DetailNode, DetailEdge>;
  private clickTimer: number | null = null;
  private mainGraphPositionCache = new Map<
    string,
    { x: number; y: number }
  >();

  get hasActiveData(): boolean {
    return this.getGraphNodeIds().length > 0;
  }

  get emptyStateText(): string {
    //No graph data is available or the current dataset doesn't have any correlations.
    return 'No graph data is available or the current dataset doesn\'t have any correlations.';
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.rebuildHierarchyStates();

    this.resizeObserver = new ResizeObserver(() => {
      if (this.viewMode === 'detail' && this.focusedStructure) {
        this.renderStructureDetail(this.focusedStructure, false);
        return;
      }

      if (this.hasActiveData) {
        this.renderCombinedView(false);
      }
    });

    this.resizeObserver.observe(
      this.graphContainerRef.nativeElement
    );

    if (this.hasActiveData) {
      this.renderCombinedView(true);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewInitialized) {
      return;
    }

    if (
      changes['graphData'] ||
      changes['nPtychsData'] ||
      changes['hotspotsData']
    ) {
      this.detailSimulation?.stop();
      this.focusedStructure = null;
      this.viewMode = 'combined';
      this.hierarchyAnchor = null;
      this.viewTransform = d3.zoomIdentity;
      this.combinedTransformBeforeDetail = null;
      this.rebuildHierarchyStates();

      if (this.hasActiveData) {
        this.renderCombinedView(true);
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

  private rebuildHierarchyStates(): void {
    this.nPtychState = this.nPtychsData?.length
      ? this.buildDatasetState('n-ptych', this.nPtychsData)
      : this.createEmptyDatasetState();

    this.hotspotState = this.hotspotsData?.length
      ? this.buildDatasetState('hotspot', this.hotspotsData)
      : this.createEmptyDatasetState();
  }

  private createEmptyDatasetState(): HierarchyDatasetState {
    return {
      allStructures: [],
      structureMap: new Map<string, AnalysisStructure>(),
      structuresBySize: new Map<number, AnalysisStructure[]>(),
      childrenCache: new Map<string, AnalysisStructure[]>(),
      rootStructures: [],
      expandedViewPaths: new Set<string>(),
      selectedViewPathId: null
    };
  }

  private buildDatasetState(
    kind: StructureKind,
    apiData: Array<NPtychApiData | HotspotApiData>
  ): HierarchyDatasetState {
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
          }))
          .filter(edge => edge.source && edge.target);

      let members: string[];
      let key: string;
      let centerId: string | undefined;

      if (kind === 'n-ptych') {
        members = [...rawNodes].sort();
        key = this.createNPtychKey(members);
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

        members = [centerId, ...leaves];
        key = this.createHotspotKey(centerId, leaves);
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

    const groupedHotspots = this.getGroupedRootHotspots(state);
    const groupedHotspotKeys = new Set(
      groupedHotspots.map(structure => structure.key)
    );

    state.rootStructures.forEach((structure, index) => {
      if (groupedHotspotKeys.has(structure.key)) {
        return;
      }

      state.expandedViewPaths.add(
        this.createRootViewPath(structure, index)
      );
    });

    if (state.rootStructures.length > 0) {
      const firstVisibleRoot = state.rootStructures.find(
        structure => !groupedHotspotKeys.has(structure.key)
      );

      if (firstVisibleRoot) {
        const rootIndex = state.rootStructures.indexOf(firstVisibleRoot);
        state.selectedViewPathId = this.createRootViewPath(
          firstVisibleRoot,
          rootIndex
        );
      }
      else if (groupedHotspots.length > 0) {
        state.selectedViewPathId = this.HOTSPOT_H2_GROUP_PATH;
      }
    }

    return state;
  }

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
        this.isDirectlyContained(structure, parent)
      );

      if (!hasParent) {
        roots.push(structure);
      }
    }

    return roots;
  }

  private getGroupedRootHotspots(
    state: HierarchyDatasetState
  ): AnalysisStructure[] {
    const h2Roots = state.rootStructures.filter(
      structure =>
        structure.kind === 'hotspot' &&
        structure.size === this.MIN_HOTSPOT_SIZE
    );

    return h2Roots.length > this.HOTSPOT_H2_GROUP_THRESHOLD
      ? h2Roots
      : [];
  }

  private getRootViewNodes(
    state: HierarchyDatasetState
  ): HierarchyViewNode[] {
    const groupedHotspots = this.getGroupedRootHotspots(state);
    const groupedKeys = new Set(
      groupedHotspots.map(structure => structure.key)
    );

    const roots = state.rootStructures
      .map((structure, index) => ({
        structure,
        index
      }))
      .filter(entry => !groupedKeys.has(entry.structure.key))
      .map(entry => ({
        viewPathId: this.createRootViewPath(
          entry.structure,
          entry.index
        ),
        parentViewPathId: '__ROOT__',
        structure: entry.structure,
        virtualRoot: false
      } as HierarchyViewNode));

    if (groupedHotspots.length > 0) {
      roots.push({
        viewPathId: this.HOTSPOT_H2_GROUP_PATH,
        parentViewPathId: '__ROOT__',
        structure: null,
        virtualRoot: false,
        aggregateKind: 'hotspot-h2',
        aggregateStructures: groupedHotspots
      });
    }

    return roots;
  }

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
        this.isDirectlyContained(child, parent)
      )
      .sort((a, b) =>
        a.key.localeCompare(b.key)
      );

    state.childrenCache.set(parent.key, children);
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

    return this.isNestedHotspot(child, parent);
  }

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

    return this.isSubset(childLeaves, parentLeaves);
  }

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
      return this.getRootViewNodes(state);
    }

    if (node.aggregateKind === 'hotspot-h2') {
      if (!state.expandedViewPaths.has(node.viewPathId)) {
        return undefined;
      }

      return (node.aggregateStructures ?? []).map(structure => ({
        viewPathId: `${node.viewPathId}>${structure.key}`,
        parentViewPathId: node.viewPathId,
        structure,
        virtualRoot: false
      }));
    }

    if (!node.structure) {
      return undefined;
    }

    if (!state.expandedViewPaths.has(node.viewPathId)) {
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
      viewPathId: `${node.viewPathId}>${child.key}`,
      parentViewPathId: node.viewPathId,
      structure: child,
      virtualRoot: false
    }));
  }

  private getMainGraphWidth(): number {
    const nodeCount = this.getGraphNodeIds().length;
    const edgeCount = this.getGraphEdges().length;

    const columns = Math.max(
      2,
      Math.ceil(
        Math.sqrt(Math.max(1, nodeCount) * 1.35)
      )
    );

    const averageDegree = nodeCount > 0
      ? (edgeCount * 2) / nodeCount
      : 0;

    const widthFromNodes =
      columns *
        (this.MAIN_GRAPH_NODE_WIDTH +
          this.MAIN_GRAPH_HORIZONTAL_SPREAD) +
      this.MAIN_GRAPH_SIDE_PADDING * 2;

    const widthFromEdges =
      this.MAIN_GRAPH_MIN_WIDTH +
      Math.min(8200, edgeCount * 42);

    const widthFromDensity =
      this.MAIN_GRAPH_MIN_WIDTH +
      nodeCount * 92 +
      averageDegree * 220;

    const desiredWidth = Math.max(
      this.MAIN_GRAPH_MIN_WIDTH,
      widthFromNodes,
      widthFromEdges,
      widthFromDensity
    );

    return Math.min(
      this.MAIN_GRAPH_MAX_WIDTH,
      Math.max(
        this.MAIN_GRAPH_MIN_WIDTH,
        desiredWidth * this.MAIN_GRAPH_BOX_SCALE
      )
    );
  }

  private getMainGraphHeight(): number {
    const nodeCount = this.getGraphNodeIds().length;
    const edgeCount = this.getGraphEdges().length;

    const columns = Math.max(
      2,
      Math.ceil(
        Math.sqrt(Math.max(1, nodeCount) * 1.35)
      )
    );

    const rows = Math.max(
      2,
      Math.ceil(Math.max(1, nodeCount) / columns)
    );

    const averageDegree = nodeCount > 0
      ? (edgeCount * 2) / nodeCount
      : 0;

    const heightFromNodes =
      rows * this.MAIN_GRAPH_VERTICAL_SPREAD +
      this.MAIN_GRAPH_TOP_PADDING +
      210;

    const heightFromEdges =
      this.MAIN_GRAPH_MIN_HEIGHT +
      Math.min(6200, edgeCount * 34);

    const heightFromDensity =
      this.MAIN_GRAPH_MIN_HEIGHT +
      nodeCount * 72 +
      averageDegree * 180;

    const desiredHeight = Math.max(
      this.MAIN_GRAPH_MIN_HEIGHT,
      heightFromNodes,
      heightFromEdges,
      heightFromDensity
    );

    return Math.min(
      this.MAIN_GRAPH_MAX_HEIGHT,
      Math.max(
        this.MAIN_GRAPH_MIN_HEIGHT,
        desiredHeight * this.MAIN_GRAPH_BOX_SCALE
      )
    );
  }

  private getHierarchyBaseOffset(): number {
    return (
      this.getMainGraphHeight() / 2 +
      this.GRAPH_BRANCH_GAP
    );
  }

  private buildHierarchyRenderData(
    side: StructureKind,
    state: HierarchyDatasetState
  ): HierarchyRenderData {
    if (state.rootStructures.length === 0) {
      return {
        nodes: [],
        links: []
      };
    }

    const root = d3.hierarchy<HierarchyViewNode>(
      this.buildVisibleHierarchy(),
      node => this.getVisibleChildren(node, state)
    );

    const treeLayout = d3
      .tree<HierarchyViewNode>()
      .nodeSize([
        this.HORIZONTAL_SPACING,
        this.VERTICAL_SPACING
      ])
      .separation((a, b) => {
        const sameParent = a.parent === b.parent;
        const baseSeparation = sameParent ? 1 : 2;

        if (Math.max(a.depth, b.depth) <= 1) {
          return baseSeparation;
        }

        const branchFactor = sameParent
          ? 1
          : this.CROSS_BRANCH_HORIZONTAL_FACTOR;

        return (
          baseSeparation *
          this.DEEP_HIERARCHY_HORIZONTAL_FACTOR *
          branchFactor
        );
      });

    const pointRoot = treeLayout(root);
    const hierarchyBaseOffset =
      this.getHierarchyBaseOffset();

    let hotspotH2GroupOffset = 0;

    if (side === 'hotspot') {
      const descendants = pointRoot.descendants();

      const belongsToH2Group = (
        node: d3.HierarchyPointNode<HierarchyViewNode>
      ): boolean =>
        node.data.viewPathId === this.HOTSPOT_H2_GROUP_PATH ||
        node.data.viewPathId.startsWith(
          `${this.HOTSPOT_H2_GROUP_PATH}>`
        );

      const groupedNodes = descendants.filter(belongsToH2Group);
      const regularNodes = descendants.filter(node =>
        !node.data.virtualRoot && !belongsToH2Group(node)
      );

      if (groupedNodes.length > 0 && regularNodes.length > 0) {
        const regularRightEdge = Math.max(
          ...regularNodes.map(node => node.x + this.CARD_WIDTH / 2)
        );

        const groupedLeftEdge = Math.min(
          ...groupedNodes.map(node => node.x - this.CARD_WIDTH / 2)
        );

        const desiredGroupedLeftEdge =
          regularRightEdge +
          this.HOTSPOT_H2_GROUP_HORIZONTAL_GAP;

        hotspotH2GroupOffset = Math.max(
          0,
          desiredGroupedLeftEdge - groupedLeftEdge
        );
      }
    }

    const nodes: RenderedHierarchyNode[] = pointRoot
      .descendants()
      .filter(node => !node.data.virtualRoot)
      .map(node => {
        const belongsToHotspotH2Group =
          side === 'hotspot' &&
          (
            node.data.viewPathId === this.HOTSPOT_H2_GROUP_PATH ||
            node.data.viewPathId.startsWith(
              `${this.HOTSPOT_H2_GROUP_PATH}>`
            )
          );

        return {
          side,
          hierarchyNode: node,
          x:
            node.x +
            (belongsToHotspotH2Group
              ? hotspotH2GroupOffset
              : 0),
          y:
            side === 'n-ptych'
              ? hierarchyBaseOffset + node.y
              : -hierarchyBaseOffset - node.y
        };
      });

    const nodeMap = new Map<string, RenderedHierarchyNode>();

    nodes.forEach(node =>
      nodeMap.set(
        node.hierarchyNode.data.viewPathId,
        node
      )
    );

    const links: RenderedHierarchyLink[] = pointRoot
      .links()
      .filter(link => !link.target.data.virtualRoot)
      .map(link => ({
        side,
        source: link.source.data.virtualRoot
          ? null
          : nodeMap.get(
              link.source.data.viewPathId
            ) ?? null,
        target: nodeMap.get(
          link.target.data.viewPathId
        )!
      }))
      .filter(link => !!link.target);

    return {
      nodes,
      links
    };
  }

  private getState(
    side: StructureKind
  ): HierarchyDatasetState {
    return side === 'hotspot'
      ? this.hotspotState
      : this.nPtychState;
  }

  private handleNodeClick(
    renderedNode: RenderedHierarchyNode
  ): void {
    const node = renderedNode.hierarchyNode.data;
    const state = this.getState(renderedNode.side);

    this.hierarchyAnchor = {
      side: renderedNode.side,
      viewPathId: node.viewPathId,
      screenX: this.viewTransform.applyX(
        renderedNode.x
      ),
      screenY: this.viewTransform.applyY(
        renderedNode.y
      )
    };

    state.selectedViewPathId = node.viewPathId;

    if (node.aggregateKind === 'hotspot-h2') {
      if (state.expandedViewPaths.has(node.viewPathId)) {
        this.collapseViewPath(node.viewPathId, state);
      }
      else {
        state.expandedViewPaths.add(node.viewPathId);
      }

      this.renderCombinedView(false);
      return;
    }

    const structure = node.structure;

    if (!structure) {
      return;
    }

    const children = this.getDirectChildren(
      structure,
      state
    );

    if (children.length === 0) {
      this.renderCombinedView(false);
      return;
    }

    if (node.parentViewPathId === '__ROOT__') {
      this.collapseDescendants(
        node.viewPathId,
        state
      );

      state.expandedViewPaths.add(
        node.viewPathId
      );

      this.renderCombinedView(false);
      return;
    }

    const expanded = state.expandedViewPaths.has(
      node.viewPathId
    );

    if (expanded) {
      this.collapseViewPath(
        node.viewPathId,
        state
      );

      this.renderCombinedView(false);
      return;
    }

    this.collapseSiblingBranches(node, state);

    state.expandedViewPaths.add(
      node.viewPathId
    );

    this.renderCombinedView(false);
  }

  private openStructureDetail(
    structure: AnalysisStructure
  ): void {
    this.combinedTransformBeforeDetail = this.viewTransform;
    this.hierarchyAnchor = null;
    this.cancelPendingClick();
    this.detailSimulation?.stop();
    this.focusedStructure = structure;
    this.viewMode = 'detail';
    this.detailTransform = d3.zoomIdentity;
    this.renderStructureDetail(structure, true);
  }

  private closeStructureDetail(): void {
    this.detailSimulation?.stop();
    this.focusedStructure = null;
    this.viewMode = 'combined';
    this.hierarchyAnchor = null;

    if (this.combinedTransformBeforeDetail) {
      this.viewTransform = this.combinedTransformBeforeDetail;
    }

    this.combinedTransformBeforeDetail = null;
    this.renderCombinedView(false);
  }

  private createMainGraphStructure(): AnalysisStructure | null {
    const members = this.getGraphNodeIds();
    const edges = this.getGraphEdges();

    if (members.length === 0 || edges.length === 0) {
      return null;
    }

    return {
      key: '__correlation_graph__',
      kind: 'n-ptych',
      size: members.length,
      members,
      edges,
      displayTitle: 'Correlation graph',
      displayStats: `${members.length} nodes · ${edges.length} edges`
    };
  }

  private openMainGraphDetail(): void {
    const structure = this.createMainGraphStructure();

    if (!structure) {
      return;
    }

    this.openStructureDetail(structure);
  }

  private scheduleSingleClick(
    node: RenderedHierarchyNode
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
        expandedPath.startsWith(`${viewPathId}>`)
      ) {
        state.expandedViewPaths.delete(expandedPath);
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
        expandedPath.startsWith(`${viewPathId}>`)
      ) {
        state.expandedViewPaths.delete(expandedPath);
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

  private renderCombinedView(
    resetView: boolean
  ): void {
    if (
      !this.svgRef ||
      !this.graphContainerRef
    ) {
      return;
    }

    if (!this.hasActiveData) {
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
      .attr('viewBox', `0 0 ${width} ${height}`);

    svg.selectAll('*').remove();

    const defs = svg.append('defs');

    defs
      .append('marker')
      .attr('id', 'combined-hierarchy-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#9ca3af');

    const world = svg
      .append('g')
      .attr('class', 'combined-world')
      .attr(
        'transform',
        this.viewTransform.toString()
      );

    const linksGroup = world
      .append('g')
      .attr('class', 'combined-links');

    const graphGroup = world
      .append('g')
      .attr('class', 'main-graph');

    const cardsGroup = world
      .append('g')
      .attr('class', 'structure-cards');

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .filter((event: any) => {
        const target = event.target as Element | null;

        if (
          event.type === 'mousedown' &&
          target?.closest('.structure-card')
        ) {
          return false;
        }

        return true;
      })
      .on('zoom', event => {
        this.viewTransform = event.transform;

        world.attr(
          'transform',
          event.transform.toString()
        );
      });

    svg.call(zoomBehavior);
    svg.call(
      zoomBehavior.transform,
      this.viewTransform
    );
    svg.on('dblclick.zoom', null);

    const hotspotRender = this.buildHierarchyRenderData(
      'hotspot',
      this.hotspotState
    );

    const nPtychRender = this.buildHierarchyRenderData(
      'n-ptych',
      this.nPtychState
    );

    const allNodes = [
      ...hotspotRender.nodes,
      ...nPtychRender.nodes
    ];

    if (!resetView && this.hierarchyAnchor) {
      const anchor = this.hierarchyAnchor;

      const anchorNode = allNodes.find(node =>
        node.side === anchor.side &&
        node.hierarchyNode.data.viewPathId ===
          anchor.viewPathId
      );

      if (anchorNode) {
        const scale = this.viewTransform.k;

        const translateX =
          anchor.screenX - anchorNode.x * scale;

        const translateY =
          anchor.screenY - anchorNode.y * scale;

        this.viewTransform = d3.zoomIdentity
          .translate(translateX, translateY)
          .scale(scale);

        world.attr(
          'transform',
          this.viewTransform.toString()
        );

        svg.call(
          zoomBehavior.transform,
          this.viewTransform
        );
      }

      this.hierarchyAnchor = null;
    }

    this.drawHierarchyLinks(
      linksGroup,
      hotspotRender.links
    );

    this.drawHierarchyLinks(
      linksGroup,
      nPtychRender.links
    );

    this.drawMainGraph(graphGroup);

    this.drawStructureCards(
      cardsGroup,
      hotspotRender.nodes,
      this.hotspotState
    );

    this.drawStructureCards(
      cardsGroup,
      nPtychRender.nodes,
      this.nPtychState
    );

    this.drawBranchLabels(world);

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
        'Click = expand · Double-click = open graph · Wheel = zoom · Drag background = pan'
      );

    if (resetView) {
      this.fitCombinedToView(
        svg,
        zoomBehavior,
        allNodes,
        width,
        height
      );
    }
  }

  private drawHierarchyLinks(
    group: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >,
    links: RenderedHierarchyLink[]
  ): void {
    const mainGraphHalfHeight =
      this.getMainGraphHeight() / 2;

    group
      .selectAll<SVGPathElement, RenderedHierarchyLink>(
        `path.${links[0]?.side ?? 'empty'}-link`
      )
      .data(links)
      .enter()
      .append('path')
      .attr(
        'class',
        link => `${link.side}-link`
      )
      .attr('fill', 'none')
      .attr('stroke', link =>
        link.side === 'hotspot'
          ? '#c4b5fd'
          : '#c7cbd4'
      )
      .attr('stroke-width', 2)
      .attr(
        'marker-end',
        'url(#combined-hierarchy-arrow)'
      )
      .attr('d', link => {
        const isHotspot = link.side === 'hotspot';

        const sourceX = link.source?.x ?? 0;
        const sourceY = link.source
          ? isHotspot
            ? link.source.y - this.CARD_HEIGHT / 2
            : link.source.y + this.CARD_HEIGHT / 2
          : isHotspot
            ? -mainGraphHalfHeight
            : mainGraphHalfHeight;

        const targetX = link.target.x;
        const targetY = isHotspot
          ? link.target.y + this.CARD_HEIGHT / 2
          : link.target.y - this.CARD_HEIGHT / 2;

        const middleY = (sourceY + targetY) / 2;

        return `
          M ${sourceX} ${sourceY}
          C ${sourceX} ${middleY},
            ${targetX} ${middleY},
            ${targetX} ${targetY}
        `;
      });
  }

  private drawBranchLabels(
    world: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >
  ): void {
    const mainGraphHalfHeight =
      this.getMainGraphHeight() / 2;

    world
      .append('text')
      .attr('x', 0)
      .attr(
        'y',
        -mainGraphHalfHeight - 34
      )
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 12)
      .attr('font-weight', 700)
      .attr('letter-spacing', 1.5)
      .attr('fill', '#7c3aed')
      .text(
        this.hotspotState.allStructures.length
          ? 'HOTSPOTS'
          : 'NO HOTSPOTS'
      );

    world
      .append('text')
      .attr('x', 0)
      .attr(
        'y',
        mainGraphHalfHeight + 44
      )
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 12)
      .attr('font-weight', 700)
      .attr('letter-spacing', 1.5)
      .attr('fill', '#3f51b5')
      .text(
        this.nPtychState.allStructures.length
          ? 'N-PTYCHS'
          : 'NO N-PTYCHS'
      );
  }

  private drawStructureCards(
    group: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >,
    nodes: RenderedHierarchyNode[],
    state: HierarchyDatasetState
  ): void {
    if (nodes.length === 0) {
      return;
    }

    const cards = group
      .selectAll<SVGGElement, RenderedHierarchyNode>(
        `g.structure-card-${nodes[0].side}`
      )
      .data(
        nodes,
        node => node.hierarchyNode.data.viewPathId
      )
      .enter()
      .append('g')
      .attr(
        'class',
        node => `structure-card structure-card-${node.side}`
      )
      .attr(
        'transform',
        node => `translate(${node.x}, ${node.y})`
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

        if (node.hierarchyNode.data.aggregateKind === 'hotspot-h2') {
          this.handleNodeClick(node);
          return;
        }

        if (node.hierarchyNode.data.structure) {
          this.openStructureDetail(
            node.hierarchyNode.data.structure
          );
        }
      });

    cards
      .append('rect')
      .attr('x', -this.CARD_WIDTH / 2 + 3)
      .attr('y', -this.CARD_HEIGHT / 2 + 4)
      .attr('width', this.CARD_WIDTH)
      .attr('height', this.CARD_HEIGHT)
      .attr('rx', 12)
      .attr('fill', 'rgba(0,0,0,0.06)');

    cards
      .append('rect')
      .attr('x', -this.CARD_WIDTH / 2)
      .attr('y', -this.CARD_HEIGHT / 2)
      .attr('width', this.CARD_WIDTH)
      .attr('height', this.CARD_HEIGHT)
      .attr('rx', 12)
      .attr('fill', node =>
        node.hierarchyNode.data.viewPathId ===
        state.selectedViewPathId
          ? node.side === 'hotspot'
            ? '#f5f3ff'
            : '#eef2ff'
          : '#ffffff'
      )
      .attr('stroke', node =>
        node.hierarchyNode.data.viewPathId ===
        state.selectedViewPathId
          ? node.side === 'hotspot'
            ? '#7c3aed'
            : '#3f51b5'
          : '#d9dde5'
      )
      .attr('stroke-width', node =>
        node.hierarchyNode.data.viewPathId ===
        state.selectedViewPathId
          ? 2.5
          : 1.5
      );

    cards.each((renderedNode, index, elements) => {
      const nodeData = renderedNode.hierarchyNode.data;
      const card = d3.select<SVGGElement, unknown>(
        elements[index] as SVGGElement
      );

      if (nodeData.aggregateKind === 'hotspot-h2') {
        this.drawHotspotH2GroupCard(
          card,
          nodeData,
          state
        );
        return;
      }

      const structure = nodeData.structure;

      if (!structure) {
        return;
      }

      const headerLines = this.getCardHeaderLines(
        structure.members
      );

      const fontSize =
        headerLines.length <= 2
          ? 13
          : headerLines.length <= 4
            ? 11
            : 9.5;

      const lineHeight =
        headerLines.length <= 2
          ? 17
          : headerLines.length <= 4
            ? 14
            : 12;

      const headerText = card
        .append('text')
        .attr('x', 0)
        .attr('y', -this.CARD_HEIGHT / 2 + 23)
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', fontSize)
        .attr('font-weight', 700)
        .attr('fill', '#111827');

      headerLines.forEach((line, lineIndex) => {
        headerText
          .append('tspan')
          .attr('x', 0)
          .attr('dy', lineIndex === 0 ? 0 : lineHeight)
          .text(line);
      });

      if (structure.kind === 'hotspot') {
        this.drawMiniHotspot(card, structure);
      }
      else {
        this.drawMiniNPtych(card, structure);
      }

      card
        .append('text')
        .attr('x', 0)
        .attr('y', this.CARD_HEIGHT / 2 - 32)
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 10.5)
        .attr('font-weight', 600)
        .attr('fill', '#4b5563')
        .text(
          `Average correlation: ${this
            .getStructureAverageCorrelation(structure)
            .toFixed(2)}`
        );

      card
        .append('text')
        .attr('x', 0)
        .attr('y', this.CARD_HEIGHT / 2 - 15)
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 10)
        .attr('fill', '#9ca3af')
        .text(this.getStructureStats(structure));

      card
        .append('title')
        .text(
          `${structure.members.join(' · ')}

Double-click to open graph`
        );
    });
  }

  private drawHotspotH2GroupCard(
    card: d3.Selection<SVGGElement, unknown, null, undefined>,
    node: HierarchyViewNode,
    state: HierarchyDatasetState
  ): void {
    const count = node.aggregateStructures?.length ?? 0;
    const expanded = state.expandedViewPaths.has(node.viewPathId);

    card
      .append('text')
      .attr('x', 0)
      .attr('y', -this.CARD_HEIGHT / 2 + 28)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 15)
      .attr('font-weight', 700)
      .attr('fill', '#111827')
      .text('H2 HOTSPOTS');

    const mini = card
      .append('g')
      .attr('transform', 'translate(0, 4)');

    [-24, 0, 24].forEach((x, index) => {
      mini
        .append('circle')
        .attr('cx', x)
        .attr('cy', index === 1 ? -18 : 18)
        .attr('r', index === 1 ? 8 : 6)
        .attr('fill', index === 1 ? '#f5f3ff' : '#ffffff')
        .attr('stroke', '#7c3aed')
        .attr('stroke-width', 2);
    });

    mini
      .append('line')
      .attr('x1', 0)
      .attr('y1', -10)
      .attr('x2', -24)
      .attr('y2', 12)
      .attr('stroke', '#8b5cf6')
      .attr('stroke-width', 2);

    mini
      .append('line')
      .attr('x1', 0)
      .attr('y1', -10)
      .attr('x2', 24)
      .attr('y2', 12)
      .attr('stroke', '#8b5cf6')
      .attr('stroke-width', 2);

    card
      .append('text')
      .attr('x', 0)
      .attr('y', 65)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 22)
      .attr('font-weight', 700)
      .attr('fill', '#7c3aed')
      .text(String(count));

    card
      .append('text')
      .attr('x', 0)
      .attr('y', this.CARD_HEIGHT / 2 - 15)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 10)
      .attr('fill', '#9ca3af')
      .text(
        `${count} grouped · ${expanded ? 'click to collapse' : 'click to expand'}`
      );

    card
      .append('title')
      .text(
        `${count} root H2 hotspots
${expanded ? 'Click to collapse' : 'Click to expand'}`
      );
  }

  private drawMainGraph(
    group: d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >
  ): void {
    const normalizedEdges = this.getGraphEdges();
    const nodeIds = this.getGraphNodeIds();
    const mainGraphWidth = this.getMainGraphWidth();
    const mainGraphHeight = this.getMainGraphHeight();

    group
      .style('cursor', 'pointer')
      .on('dblclick.mainGraph', event => {
        event.preventDefault();
        event.stopPropagation();
        this.openMainGraphDetail();
      });

    const shadowRect = group
      .append('rect')
      .attr('x', -mainGraphWidth / 2 + 4)
      .attr('y', -mainGraphHeight / 2 + 5)
      .attr('width', mainGraphWidth)
      .attr('height', mainGraphHeight)
      .attr('rx', 18)
      .attr('fill', 'rgba(0,0,0,0.08)');

    const backgroundRect = group
      .append('rect')
      .attr('x', -mainGraphWidth / 2)
      .attr('y', -mainGraphHeight / 2)
      .attr('width', mainGraphWidth)
      .attr('height', mainGraphHeight)
      .attr('rx', 18)
      .attr('fill', '#ffffff')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 2);

    group
      .append('text')
      .attr('x', 0)
      .attr('y', -mainGraphHeight / 2 + 34)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 21)
      .attr('font-weight', 700)
      .attr('fill', '#111827')
      .text('Correlation graph');

    group
      .append('text')
      .attr('x', 0)
      .attr('y', -mainGraphHeight / 2 + 58)
      .attr('text-anchor', 'middle')
      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )
      .attr('font-size', 12)
      .attr('fill', '#6b7280')
      .text(
        `${nodeIds.length} nodes · ${normalizedEdges.length} edges`
      );


    if (nodeIds.length === 0 || normalizedEdges.length === 0) {
      group
        .append('text')
        .attr('x', 0)
        .attr('y', 8)
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 14)
        .attr('fill', '#9ca3af')
        .text('No connected correlations available.');

      return;
    }

    const degreeMap = new Map<string, number>();

    nodeIds.forEach(id => degreeMap.set(id, 0));

    normalizedEdges.forEach(edge => {
      degreeMap.set(
        edge.source,
        (degreeMap.get(edge.source) ?? 0) + 1
      );

      degreeMap.set(
        edge.target,
        (degreeMap.get(edge.target) ?? 0) + 1
      );
    });

    const initialRadius = Math.min(
      1700,
      Math.max(
        760,
        Math.sqrt(Math.max(1, nodeIds.length)) * 220
      )
    );

    const goldenAngle =
      Math.PI * (3 - Math.sqrt(5));

    const nodes: MainGraphNode[] = nodeIds.map((id, index) => {
      const lines = this.wrapAttributeLabel(
        id,
        this.ATTRIBUTE_LINE_LENGTH
      );

      const boxHeight = Math.max(
        56,
        26 + lines.length * 18
      );

      const normalizedRadius =
        Math.sqrt(
          (index + 0.5) /
          Math.max(1, nodeIds.length)
        );

      const angle =
        index * goldenAngle -
        Math.PI / 2;

      return {
        id,
        lines,
        boxHeight,
        x:
          Math.cos(angle) *
          initialRadius *
          normalizedRadius,
        y:
          Math.sin(angle) *
          initialRadius *
          normalizedRadius
      };
    });

    const nodeIndex = new Map<string, number>();

    nodes.forEach((node, index) => {
      nodeIndex.set(node.id, index);
    });

    const displacementX =
      new Array<number>(nodes.length).fill(0);

    const displacementY =
      new Array<number>(nodes.length).fill(0);

    for (
      let iteration = 0;
      iteration < this.MAIN_GRAPH_FA2_ITERATIONS;
      iteration++
    ) {
      displacementX.fill(0);
      displacementY.fill(0);

      for (
        let left = 0;
        left < nodes.length;
        left++
      ) {
        const leftNode = nodes[left];

        for (
          let right = left + 1;
          right < nodes.length;
          right++
        ) {
          const rightNode = nodes[right];

          let dx =
            (leftNode.x ?? 0) -
            (rightNode.x ?? 0);

          let dy =
            (leftNode.y ?? 0) -
            (rightNode.y ?? 0);

          let distanceSquared =
            dx * dx + dy * dy;

          if (distanceSquared < 1) {
            const angle =
              (
                (left + 1) * 2.399963229728653 +
                (right + 1) * 0.618033988749895
              ) %
              (Math.PI * 2);

            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distanceSquared = 1;
          }

          const repulsion =
            this.MAIN_GRAPH_FA2_REPULSION /
            distanceSquared;

          displacementX[left] +=
            dx * repulsion;

          displacementY[left] +=
            dy * repulsion;

          displacementX[right] -=
            dx * repulsion;

          displacementY[right] -=
            dy * repulsion;
        }
      }

      normalizedEdges.forEach(edge => {
        const sourceIndex =
          nodeIndex.get(edge.source);

        const targetIndex =
          nodeIndex.get(edge.target);

        if (
          sourceIndex === undefined ||
          targetIndex === undefined
        ) {
          return;
        }

        const source = nodes[sourceIndex];
        const target = nodes[targetIndex];

        const dx =
          (target.x ?? 0) -
          (source.x ?? 0);

        const dy =
          (target.y ?? 0) -
          (source.y ?? 0);

        const distance = Math.max(
          1,
          Math.sqrt(dx * dx + dy * dy)
        );

        const excessDistance =
          distance -
          this.MAIN_GRAPH_FA2_EDGE_LENGTH;

        if (excessDistance <= 0) {
          return;
        }

        const sourceDegree =
          Math.max(
            1,
            degreeMap.get(edge.source) ?? 1
          );

        const targetDegree =
          Math.max(
            1,
            degreeMap.get(edge.target) ?? 1
          );

        const sourceAttraction =
          (
            excessDistance *
            this.MAIN_GRAPH_FA2_ATTRACTION
          ) /
          sourceDegree;

        const targetAttraction =
          (
            excessDistance *
            this.MAIN_GRAPH_FA2_ATTRACTION
          ) /
          targetDegree;

        const nx = dx / distance;
        const ny = dy / distance;

        displacementX[sourceIndex] +=
          nx * sourceAttraction;

        displacementY[sourceIndex] +=
          ny * sourceAttraction;

        displacementX[targetIndex] -=
          nx * targetAttraction;

        displacementY[targetIndex] -=
          ny * targetAttraction;
      });

      nodes.forEach((node, index) => {
        displacementX[index] -=
          (node.x ?? 0) *
          this.MAIN_GRAPH_FA2_GRAVITY;

        displacementY[index] -=
          (node.y ?? 0) *
          this.MAIN_GRAPH_FA2_GRAVITY;
      });

      const progress =
        iteration /
        Math.max(
          1,
          this.MAIN_GRAPH_FA2_ITERATIONS - 1
        );

      const maxStep =
        this.MAIN_GRAPH_FA2_FINAL_STEP +
        (
          this.MAIN_GRAPH_FA2_INITIAL_STEP -
          this.MAIN_GRAPH_FA2_FINAL_STEP
        ) *
        Math.pow(
          1 - progress,
          1.8
        );

      nodes.forEach((node, index) => {
        const dx = displacementX[index];
        const dy = displacementY[index];

        const length =
          Math.sqrt(dx * dx + dy * dy);

        if (
          !Number.isFinite(length) ||
          length <= 0
        ) {
          return;
        }

        const step =
          Math.min(
            maxStep,
            length
          );

        node.x =
          (node.x ?? 0) +
          (dx / length) * step;

        node.y =
          (node.y ?? 0) +
          (dy / length) * step;
      });
    }

    const availableWidth =
      mainGraphWidth -
      this.MAIN_GRAPH_SIDE_PADDING * 2;

    const availableHeight =
      mainGraphHeight -
      this.MAIN_GRAPH_TOP_PADDING -
      130;

    const maxNodeHeight = Math.max(
      ...nodes.map(node => node.boxHeight),
      56
    );

    const horizontalSafety =
      this.MAIN_GRAPH_NODE_WIDTH / 2 +
      this.MAIN_GRAPH_EDGE_SAFETY * 0.45;

    const verticalSafety =
      maxNodeHeight / 2 +
      this.MAIN_GRAPH_EDGE_SAFETY * 0.45;

    const targetWidth = Math.max(
      1,
      availableWidth -
      horizontalSafety * 2
    );

    const targetHeight = Math.max(
      1,
      availableHeight -
      verticalSafety * 2
    );

    const getBounds = (
      positions: Map<
        string,
        { x: number; y: number }
      >
    ) => {
      const xs = Array.from(
        positions.values(),
        position => position.x
      );

      const ys = Array.from(
        positions.values(),
        position => position.y
      );

      return {
        minX: Math.min(...xs, -1),
        maxX: Math.max(...xs, 1),
        minY: Math.min(...ys, -1),
        maxY: Math.max(...ys, 1)
      };
    };

    const positionMap = new Map<
      string,
      { x: number; y: number }
    >();

    nodes.forEach(node => {
      positionMap.set(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0
      });
    });

    const scalePositionsToBox = (
      fill: number
    ): void => {
      const bounds =
        getBounds(positionMap);

      const rawWidth = Math.max(
        1,
        bounds.maxX - bounds.minX
      );

      const rawHeight = Math.max(
        1,
        bounds.maxY - bounds.minY
      );

      const scaleX =
        (
          targetWidth *
          fill
        ) /
        rawWidth;

      const scaleY =
        (
          targetHeight *
          fill
        ) /
        rawHeight;

      const centerX =
        (
          bounds.minX +
          bounds.maxX
        ) /
        2;

      const centerY =
        (
          bounds.minY +
          bounds.maxY
        ) /
        2;

      positionMap.forEach(position => {
        position.x =
          (
            position.x -
            centerX
          ) *
          scaleX;

        position.y =
          (
            position.y -
            centerY
          ) *
          scaleY +
          34;
      });
    };

    scalePositionsToBox(
      this.MAIN_GRAPH_FINAL_FILL
    );

    const targetArea =
      targetWidth *
      targetHeight;

    const preferredSpacing =
      Math.max(
        this.MAIN_GRAPH_NODE_WIDTH * 1.55,
        Math.sqrt(
          targetArea /
          Math.max(1, nodes.length)
        ) *
        this.MAIN_GRAPH_UNIFORM_SPREAD_FACTOR
      );

    for (
      let pass = 0;
      pass < this.MAIN_GRAPH_UNIFORM_SPREAD_PASSES;
      pass++
    ) {
      const moveX =
        new Array<number>(nodes.length).fill(0);

      const moveY =
        new Array<number>(nodes.length).fill(0);

      let anyMovement = false;

      for (
        let left = 0;
        left < nodes.length;
        left++
      ) {
        const leftPosition =
          positionMap.get(nodes[left].id);

        if (!leftPosition) {
          continue;
        }

        for (
          let right = left + 1;
          right < nodes.length;
          right++
        ) {
          const rightPosition =
            positionMap.get(nodes[right].id);

          if (!rightPosition) {
            continue;
          }

          let dx =
            rightPosition.x -
            leftPosition.x;

          let dy =
            rightPosition.y -
            leftPosition.y;

          let distance =
            Math.sqrt(dx * dx + dy * dy);

          if (distance < 0.001) {
            const angle =
              (
                (left + 1) *
                2.399963229728653 +
                right
              ) %
              (Math.PI * 2);

            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }

          if (
            distance >= preferredSpacing
          ) {
            continue;
          }

          anyMovement = true;

          const push =
            (
              preferredSpacing -
              distance
            ) *
            0.085;

          const nx = dx / distance;
          const ny = dy / distance;

          moveX[left] -= nx * push;
          moveY[left] -= ny * push;

          moveX[right] += nx * push;
          moveY[right] += ny * push;
        }
      }

      if (!anyMovement) {
        break;
      }

      const passProgress =
        pass /
        Math.max(
          1,
          this.MAIN_GRAPH_UNIFORM_SPREAD_PASSES - 1
        );

      const damping =
        0.9 -
        passProgress * 0.45;

      nodes.forEach((node, index) => {
        const position =
          positionMap.get(node.id);

        if (!position) {
          return;
        }

        position.x +=
          moveX[index] *
          damping;

        position.y +=
          moveY[index] *
          damping;
      });

      if (
        pass > 0 &&
        pass % 30 === 0
      ) {
        scalePositionsToBox(
          this.MAIN_GRAPH_FINAL_FILL
        );
      }
    }

    for (let pass = 0; pass < 120; pass++) {
      let changed = false;

      for (
        let left = 0;
        left < nodes.length;
        left++
      ) {
        const leftNode = nodes[left];
        const leftPosition =
          positionMap.get(leftNode.id);

        if (!leftPosition) {
          continue;
        }

        for (
          let right = left + 1;
          right < nodes.length;
          right++
        ) {
          const rightNode = nodes[right];
          const rightPosition =
            positionMap.get(rightNode.id);

          if (!rightPosition) {
            continue;
          }

          const requiredX =
            this.MAIN_GRAPH_NODE_WIDTH +
            this.MAIN_GRAPH_RECTANGLE_PADDING;

          const requiredY =
            (
              leftNode.boxHeight +
              rightNode.boxHeight
            ) /
            2 +
            this.MAIN_GRAPH_RECTANGLE_PADDING;

          let dx =
            rightPosition.x -
            leftPosition.x;

          let dy =
            rightPosition.y -
            leftPosition.y;

          const overlapX =
            requiredX -
            Math.abs(dx);

          const overlapY =
            requiredY -
            Math.abs(dy);

          if (
            overlapX <= 0 ||
            overlapY <= 0
          ) {
            continue;
          }

          changed = true;

          if (
            Math.abs(dx) < 0.001 &&
            Math.abs(dy) < 0.001
          ) {
            const angle =
              (
                (left + 1) *
                2.399963229728653 +
                right
              ) %
              (Math.PI * 2);

            dx = Math.cos(angle);
            dy = Math.sin(angle);
          }

          if (overlapX < overlapY) {
            const direction =
              dx >= 0 ? 1 : -1;

            const shift =
              overlapX / 2 + 0.5;

            leftPosition.x -=
              direction * shift;

            rightPosition.x +=
              direction * shift;
          }
          else {
            const direction =
              dy >= 0 ? 1 : -1;

            const shift =
              overlapY / 2 + 0.5;

            leftPosition.y -=
              direction * shift;

            rightPosition.y +=
              direction * shift;
          }
        }
      }

      if (!changed) {
        break;
      }
    }

    scalePositionsToBox(
      this.MAIN_GRAPH_FINAL_FILL
    );

    this.mainGraphPositionCache = new Map(
      Array.from(
        positionMap.entries(),
        ([id, position]) => [
          id,
          {
            x: position.x,
            y: position.y
          }
        ]
      )
    );

    const graphBody = group
      .append('g')
      .attr('class', 'main-graph-body');

    const linksGroup = graphBody
      .append('g')
      .attr('class', 'main-graph-links');

    const edgeLabelsGroup = graphBody
      .append('g')
      .attr('class', 'main-graph-edge-labels');

    const nodesGroup = graphBody
      .append('g')
      .attr('class', 'main-graph-nodes');

    linksGroup
      .selectAll<SVGLineElement, NormalizedEdge>('line')
      .data(normalizedEdges)
      .enter()
      .append('line')
      .attr('x1', edge =>
        positionMap.get(edge.source)?.x ?? 0
      )
      .attr('y1', edge =>
        positionMap.get(edge.source)?.y ?? 0
      )
      .attr('x2', edge =>
        positionMap.get(edge.target)?.x ?? 0
      )
      .attr('y2', edge =>
        positionMap.get(edge.target)?.y ?? 0
      )
      .attr('stroke', edge =>
        edge.correlation >= 0
          ? '#596bd8'
          : '#d45f5f'
      )
      .attr('stroke-width', edge =>
        2.2 + Math.abs(edge.correlation) * 3.8
      )
      .attr('stroke-opacity', 0.86);

    const edgeLabelGroups = edgeLabelsGroup
      .selectAll<SVGGElement, NormalizedEdge>('g.edge-label')
      .data(normalizedEdges)
      .enter()
      .append('g')
      .attr('class', 'edge-label')
      .attr('transform', edge => {
        const x =
          (
            (positionMap.get(edge.source)?.x ?? 0) +
            (positionMap.get(edge.target)?.x ?? 0)
          ) / 2;

        const y =
          (
            (positionMap.get(edge.source)?.y ?? 0) +
            (positionMap.get(edge.target)?.y ?? 0)
          ) / 2 - 10;

        return `translate(${x}, ${y})`;
      });

    edgeLabelGroups
      .append('rect')
      .attr('x', -20)
      .attr('y', -9)
      .attr('width', 40)
      .attr('height', 18)
      .attr('rx', 6)
      .attr('fill', '#ffffff')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);

    edgeLabelGroups
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr(
        'font-family',
        'JetBrains Mono, Consolas, monospace'
      )
      .attr('font-size', 10.5)
      .attr('font-weight', 700)
      .attr('fill', edge =>
        edge.correlation >= 0
          ? '#3143b7'
          : '#b63b3b'
      )
      .text(edge => edge.correlation.toFixed(2));

    const graphNodes = nodesGroup
      .selectAll<SVGGElement, MainGraphNode>('g.main-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'main-node')
      .attr('transform', node => {
        const position = positionMap.get(node.id) ?? {
          x: 0,
          y: 0
        };

        return `translate(${position.x}, ${position.y})`;
      });

    graphNodes
      .append('rect')
      .attr('x', -this.MAIN_GRAPH_NODE_WIDTH / 2 + 3)
      .attr('y', node =>
        -node.boxHeight / 2 + 4
      )
      .attr('width', this.MAIN_GRAPH_NODE_WIDTH)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr('fill', 'rgba(0,0,0,0.08)');

    graphNodes
      .append('rect')
      .attr('x', -this.MAIN_GRAPH_NODE_WIDTH / 2)
      .attr('y', node =>
        -node.boxHeight / 2
      )
      .attr('width', this.MAIN_GRAPH_NODE_WIDTH)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr('fill', '#ffffff')
      .attr('stroke', '#3f51b5')
      .attr('stroke-width', 2.4);

    graphNodes.each((node, index, elements) => {
      const current = d3.select<SVGGElement, MainGraphNode>(
        elements[index] as SVGGElement
      );

      const text = current
        .append('text')
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 12.5)
        .attr('font-weight', 600)
        .attr('fill', '#1f2937');

      const lineHeight = 18;
      const totalHeight =
        (node.lines.length - 1) * lineHeight;

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

    graphNodes
      .append('title')
      .text(node => node.id);

    shadowRect.lower();
    backgroundRect.lower();
  }

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
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
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

    positions.set(centerId, center);

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
            ? '#7c3aed'
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
        .attr('stroke', '#8b5cf6')
        .attr('stroke-width', 1.8);
    });

    graph
      .append('circle')
      .attr('cx', center.x)
      .attr('cy', center.y)
      .attr('r', 8)
      .attr('fill', '#f5f3ff')
      .attr('stroke', '#7c3aed')
      .attr('stroke-width', 2.4);
  }

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
    this.detailSimulation = undefined;

    const container =
      this.graphContainerRef.nativeElement;

    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    const isMainCorrelationGraph =
      structure.key === '__correlation_graph__';

    if (resetView) {
      this.detailTransform = d3.zoomIdentity;
    }

    const svg = d3
      .select(this.svgRef.nativeElement)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    svg.selectAll('*').remove();

    const centerX = width / 2;
    const centerY = height / 2;

    const detailNodeWidth =
      isMainCorrelationGraph
        ? this.MAIN_GRAPH_NODE_WIDTH
        : 190;

    const nodes: DetailNode[] =
      structure.members.map((member, index) => {
        const lines = this.wrapAttributeLabel(
          member,
          this.ATTRIBUTE_LINE_LENGTH
        );

        const boxHeight =
          isMainCorrelationGraph
            ? Math.max(
                56,
                26 + lines.length * 18
              )
            : Math.max(
                64,
                30 + lines.length * 18
              );

        if (isMainCorrelationGraph) {
          const cached =
            this.mainGraphPositionCache.get(member);

          if (cached) {
            return {
              id: member,
              lines,
              boxHeight,
              x: cached.x,
              y: cached.y,
              isCenter: false
            };
          }

          const fallbackRadius = Math.max(
            240,
            structure.size * 36
          );

          const angle =
            (2 * Math.PI * index) /
            Math.max(1, structure.members.length) -
            Math.PI / 2;

          return {
            id: member,
            lines,
            boxHeight,
            x: Math.cos(angle) * fallbackRadius,
            y: Math.sin(angle) * fallbackRadius,
            isCenter: false
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
            Math.max(1, leaves.length) -
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
          180,
          structure.size * 48
        );

        const angle =
          (2 * Math.PI * index) /
          Math.max(1, structure.members.length) -
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

    if (!isMainCorrelationGraph) {
      const simulation = d3
        .forceSimulation<DetailNode>(nodes)
        .force(
          'link',
          d3
            .forceLink<DetailNode, DetailEdge>(edges)
            .id(node => node.id)
            .distance(
              structure.kind === 'hotspot'
                ? 230
                : 240
            )
            .strength(
              structure.kind === 'hotspot'
                ? 0.9
                : 0.6
            )
        )
        .force(
          'charge',
          d3
            .forceManyBody<DetailNode>()
            .strength(
              structure.kind === 'hotspot'
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
                detailNodeWidth / 2;

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

      if (structure.kind === 'hotspot') {
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
            d3.forceCenter<DetailNode>(
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

      simulation.stop();

      for (let index = 0; index < 500; index++) {
        simulation.tick();
      }

      this.detailSimulation = simulation;
    }

    const nodeMap =
      new Map<string, DetailNode>();

    nodes.forEach(node => {
      nodeMap.set(node.id, node);
    });

    edges.forEach(edge => {
      const sourceId =
        typeof edge.source === 'string'
          ? edge.source
          : edge.source.id;

      const targetId =
        typeof edge.target === 'string'
          ? edge.target
          : edge.target.id;

      const sourceNode =
        nodeMap.get(sourceId);

      const targetNode =
        nodeMap.get(targetId);

      if (sourceNode) {
        edge.source = sourceNode;
      }

      if (targetNode) {
        edge.target = targetNode;
      }
    });

    if (isMainCorrelationGraph && resetView) {
      const minX = Math.min(
        ...nodes.map(node =>
          (node.x ?? 0) -
          detailNodeWidth / 2
        )
      );

      const maxX = Math.max(
        ...nodes.map(node =>
          (node.x ?? 0) +
          detailNodeWidth / 2
        )
      );

      const minY = Math.min(
        ...nodes.map(node =>
          (node.y ?? 0) -
          node.boxHeight / 2
        )
      );

      const maxY = Math.max(
        ...nodes.map(node =>
          (node.y ?? 0) +
          node.boxHeight / 2
        )
      );

      const graphWidth = Math.max(
        1,
        maxX - minX
      );

      const graphHeight = Math.max(
        1,
        maxY - minY
      );

      const horizontalPadding = Math.max(
        70,
        width * 0.06
      );

      const topPadding = 100;
      const bottomPadding = 58;

      const availableWidth = Math.max(
        1,
        width - horizontalPadding * 2
      );

      const availableHeight = Math.max(
        1,
        height - topPadding - bottomPadding
      );

      const scale = Math.min(
        availableWidth / graphWidth,
        availableHeight / graphHeight
      );

      const graphCenterX =
        (minX + maxX) / 2;

      const graphCenterY =
        (minY + maxY) / 2;

      const targetCenterX = width / 2;

      const targetCenterY =
        topPadding +
        availableHeight / 2;

      this.detailTransform =
        d3.zoomIdentity
          .translate(
            targetCenterX -
            graphCenterX * scale,
            targetCenterY -
            graphCenterY * scale
          )
          .scale(scale);
    }

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

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 6])
      .filter((event: any) => {
        const target = event.target as Element | null;

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
    svg.call(
      zoomBehavior.transform,
      this.detailTransform
    );
    svg.on('dblclick.zoom', null);

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
        isMainCorrelationGraph
          ? 2.2 + Math.abs(edge.correlation) * 3.8
          : 2 + Math.abs(edge.correlation) * 2
      )
      .attr(
        'stroke-opacity',
        isMainCorrelationGraph
          ? 0.86
          : 0.72
      );

    const edgeLabels = labelsGroup
      .selectAll<SVGGElement, DetailEdge>(
        'g.edge-label'
      )
      .data(edges)
      .enter()
      .append('g')
      .attr('class', 'edge-label');

    edgeLabels
      .append('rect')
      .attr('x', -20)
      .attr('y', -9)
      .attr('width', 40)
      .attr('height', 18)
      .attr('rx', 6)
      .attr('fill', '#ffffff')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);

    edgeLabels
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr(
        'font-family',
        'JetBrains Mono, Consolas, monospace'
      )
      .attr('font-size', 10.5)
      .attr('font-weight', 700)
      .attr('fill', edge =>
        edge.correlation >= 0
          ? '#3143b7'
          : '#b63b3b'
      )
      .text(edge =>
        edge.correlation.toFixed(2)
      );

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
        -detailNodeWidth / 2 + 3
      )
      .attr('y', node =>
        -node.boxHeight / 2 + 4
      )
      .attr('width', detailNodeWidth)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr('fill', 'rgba(0,0,0,0.08)');

    nodeGroups
      .append('rect')
      .attr(
        'x',
        -detailNodeWidth / 2
      )
      .attr('y', node =>
        -node.boxHeight / 2
      )
      .attr('width', detailNodeWidth)
      .attr('height', node => node.boxHeight)
      .attr('rx', 10)
      .attr('fill', node =>
        node.isCenter
          ? '#f5f3ff'
          : '#ffffff'
      )
      .attr('stroke', node =>
        node.isCenter
          ? '#7c3aed'
          : isMainCorrelationGraph
            ? '#3f51b5'
            : '#6574d9'
      )
      .attr(
        'stroke-width',
        node =>
          node.isCenter
            ? 3
            : isMainCorrelationGraph
              ? 2.4
              : 2.5
      );

    nodeGroups.each((node, index, elements) => {
      const group = d3.select<SVGGElement, unknown>(
        elements[index] as SVGGElement
      );

      const nodeText = group
        .append('text')
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr(
          'font-size',
          isMainCorrelationGraph
            ? 12.5
            : 13
        )
        .attr('font-weight', 600)
        .attr('fill', '#1f2937');

      const lineHeight = 18;
      const totalHeight =
        (node.lines.length - 1) * lineHeight;

      node.lines.forEach((line, lineIndex) => {
        nodeText
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

    const updateDetailPositions = (): void => {
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
        .attr('transform', edge => {
          const source =
            edge.source as DetailNode;

          const target =
            edge.target as DetailNode;

          const x =
            (
              (source.x ?? 0) +
              (target.x ?? 0)
            ) /
            2;

          const y =
            (
              (source.y ?? 0) +
              (target.y ?? 0)
            ) /
            2 -
            10;

          return `translate(${x}, ${y})`;
        });

      nodeGroups.attr(
        'transform',
        node =>
          `translate(${node.x ?? 0}, ${
            node.y ?? 0
          })`
      );
    };

    updateDetailPositions();

    const dragBehavior = d3
      .drag<SVGGElement, DetailNode>()
      .on('start', (_event, node) => {
        node.fx = null;
        node.fy = null;
      })
      .on('drag', (event, node) => {
        node.x = event.x;
        node.y = event.y;
        updateDetailPositions();
      })
      .on('end', (_event, node) => {
        node.fx = null;
        node.fy = null;
        updateDetailPositions();
      });

    nodeGroups.call(dragBehavior);

    this.drawDetailControls(
      svg,
      structure,
      width
    );
  }

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
      .attr('transform', 'translate(24, 26)')
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
      .text('← Overview');

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
      .text(this.getStructureTitle(structure));

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
      .text(this.getStructureStats(structure));

    if (structure.key !== '__correlation_graph__') {
      controls
        .append('text')
        .attr('x', width / 2)
        .attr('y', 73)
        .attr('text-anchor', 'middle')
        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )
        .attr('font-size', 11)
        .attr('font-weight', 600)
        .attr('fill', '#4b5563')
        .text(
          `Average correlation: ${this
            .getStructureAverageCorrelation(structure)
            .toFixed(2)}`
        );
    }
  }

  private fitCombinedToView(
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
    nodes: RenderedHierarchyNode[],
    width: number,
    height: number
  ): void {
    const mainGraphWidth = this.getMainGraphWidth();
    const mainGraphHeight = this.getMainGraphHeight();

    const horizontalPadding = Math.max(
      90,
      width * 0.08
    );

    const verticalPadding = Math.max(
      90,
      height * 0.1
    );

    const scaleX =
      (width - horizontalPadding * 2) /
      mainGraphWidth;

    const scaleY =
      (height - verticalPadding * 2) /
      mainGraphHeight;

    let scale = Math.min(
      1,
      scaleX,
      scaleY
    );

    const nodeCount = this.getGraphNodeIds().length;

    if (nodeCount >= 24) {
      scale = Math.max(scale, 0.36);
    }
    else if (nodeCount >= 16) {
      scale = Math.max(scale, 0.42);
    }
    else if (nodeCount >= 10) {
      scale = Math.max(scale, 0.5);
    }

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale);

    this.viewTransform = transform;

    svg.call(
      zoomBehavior.transform,
      transform
    );
  }

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

  private getCardHeaderLines(
    members: string[]
  ): string[] {
    const maxCharsPerLine = 28;
    const lines: string[] = [];
    let currentLine = '';

    for (const member of members) {
      const wrappedMember = this.wrapAttributeLabel(
        member,
        maxCharsPerLine
      );

      if (wrappedMember.length > 1) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }

        lines.push(...wrappedMember);
        continue;
      }

      const token = wrappedMember[0] ?? member;
      const candidate = currentLine
        ? `${currentLine} · ${token}`
        : token;

      if (
        candidate.length <= maxCharsPerLine ||
        !currentLine
      ) {
        currentLine = candidate;
        continue;
      }

      lines.push(currentLine);
      currentLine = token;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0
      ? lines
      : [''];
  }

  private getMinimumSize(
    kind: StructureKind
  ): number {
    return kind === 'hotspot'
      ? this.MIN_HOTSPOT_SIZE
      : this.MIN_NPTYCH_SIZE;
  }

  private getStructureTitle(
    structure: AnalysisStructure
  ): string {
    if (structure.displayTitle) {
      return structure.displayTitle;
    }

    if (structure.kind === 'hotspot') {
      return `Hotspot H${Math.max(0, structure.size - 1)}`;
    }

    return `K${structure.size}`;
  }

  private getStructureAverageCorrelation(
    structure: AnalysisStructure
  ): number {
    if (structure.edges.length === 0) {
      return 0;
    }

    const correlationSum = structure.edges.reduce(
      (sum, edge) => sum + Math.abs(edge.correlation),
      0
    );

    return correlationSum / structure.edges.length;
  }

  private getStructureStats(
    structure: AnalysisStructure
  ): string {
    if (structure.displayStats) {
      return structure.displayStats;
    }

    if (structure.kind === 'hotspot') {
      return (
        `${Math.max(0, structure.size - 1)} leaves · ` +
        `${structure.edges.length} edges`
      );
    }

    return (
      `${structure.size} nodes · ` +
      `${structure.edges.length} edges`
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
      [...leaves].sort().join('|')
    );
  }

  private createNPtychKey(
    members: string[]
  ): string {
    return [...members]
      .sort()
      .join('|');
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

  private getGraphNodeIds(): string[] {
    const edges = this.getGraphEdges();
    const connectedNodeIds = new Set<string>();

    for (const edge of edges) {
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }

    return Array.from(connectedNodeIds).sort((a, b) =>
      a.localeCompare(b)
    );
  }

  private getGraphEdges(): NormalizedEdge[] {
    const uniqueEdges = new Map<string, NormalizedEdge>();

    for (const edge of this.graphData?.edges ?? []) {
      const source = this.getEndpointId(edge.source);
      const target = this.getEndpointId(edge.target);
      const correlation = Number(edge.correlation);

      if (
        !source ||
        !target ||
        source === target ||
        !Number.isFinite(correlation)
      ) {
        continue;
      }

      const key = [source, target].sort((a, b) =>
        a.localeCompare(b)
      ).join('||');

      if (!uniqueEdges.has(key)) {
        uniqueEdges.set(key, {
          source,
          target,
          correlation
        });
      }
    }

    return Array.from(uniqueEdges.values()).sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source);

      if (sourceCompare !== 0) {
        return sourceCompare;
      }

      return a.target.localeCompare(b.target);
    });
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

    if (kind === 'hotspot') {
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
      value.substring(0, maximumLength - 3) +
      '...'
    );
  }

  private formatFullMemberList(
    structure: AnalysisStructure
  ): string {
    if (structure.kind === 'hotspot') {
      const [center, ...leaves] = structure.members;

      return center
        ? `${center} → ${leaves.join(', ')}`
        : '';
    }

    return structure.members.join(', ');
  }

  private truncateLabel(
    value: string,
    maximumLength: number
  ): string {
    if (value.length <= maximumLength) {
      return value;
    }

    return `${value.substring(0, maximumLength - 3)}...`;
  }

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


  public exportVisualizationSvg(): void {
    if (!this.svgRef?.nativeElement) {
      return;
    }

    const sourceSvg = this.svgRef.nativeElement;
    const worldSelector =
      this.viewMode === 'detail'
        ? '.detail-world'
        : '.combined-world';

    const sourceWorld =
      sourceSvg.querySelector<SVGGElement>(worldSelector);

    if (!sourceWorld) {
      return;
    }

    let bbox: DOMRect | SVGRect;

    try {
      bbox = sourceWorld.getBBox();
    }
    catch {
      return;
    }

    if (
      !Number.isFinite(bbox.x) ||
      !Number.isFinite(bbox.y) ||
      !Number.isFinite(bbox.width) ||
      !Number.isFinite(bbox.height) ||
      bbox.width <= 0 ||
      bbox.height <= 0
    ) {
      return;
    }

    const namespace = 'http://www.w3.org/2000/svg';
    const padding = this.viewMode === 'detail' ? 150 : 120;
    const titleSpace = this.viewMode === 'detail' ? 90 : 0;

    const minX = bbox.x - padding;
    const minY = bbox.y - padding - titleSpace;
    const exportWidth = bbox.width + padding * 2;
    const exportHeight =
      bbox.height + padding * 2 + titleSpace;

    const exportSvg = document.createElementNS(
      namespace,
      'svg'
    );

    exportSvg.setAttribute(
      'xmlns',
      namespace
    );

    exportSvg.setAttribute(
      'xmlns:xlink',
      'http://www.w3.org/1999/xlink'
    );

    exportSvg.setAttribute(
      'viewBox',
      `${minX} ${minY} ${exportWidth} ${exportHeight}`
    );

    exportSvg.setAttribute(
      'width',
      `${Math.ceil(exportWidth)}`
    );

    exportSvg.setAttribute(
      'height',
      `${Math.ceil(exportHeight)}`
    );

    exportSvg.setAttribute(
      'preserveAspectRatio',
      'xMidYMid meet'
    );

    exportSvg.setAttribute(
      'shape-rendering',
      'geometricPrecision'
    );

    exportSvg.setAttribute(
      'text-rendering',
      'geometricPrecision'
    );

    const defs = sourceSvg.querySelector('defs');

    if (defs) {
      exportSvg.appendChild(
        defs.cloneNode(true)
      );
    }

    const background = document.createElementNS(
      namespace,
      'rect'
    );

    background.setAttribute('x', `${minX}`);
    background.setAttribute('y', `${minY}`);
    background.setAttribute('width', `${exportWidth}`);
    background.setAttribute('height', `${exportHeight}`);
    background.setAttribute('fill', '#ffffff');

    exportSvg.appendChild(background);

    const clonedWorld =
      sourceWorld.cloneNode(true) as SVGGElement;

    clonedWorld.removeAttribute('transform');

    exportSvg.appendChild(clonedWorld);

    if (
      this.viewMode === 'detail' &&
      this.focusedStructure
    ) {
      const title = document.createElementNS(
        namespace,
        'text'
      );

      title.setAttribute(
        'x',
        `${bbox.x + bbox.width / 2}`
      );

      title.setAttribute(
        'y',
        `${bbox.y - 72}`
      );

      title.setAttribute(
        'text-anchor',
        'middle'
      );

      title.setAttribute(
        'font-family',
        'Roboto, Helvetica Neue, Arial, sans-serif'
      );

      title.setAttribute(
        'font-size',
        '28'
      );

      title.setAttribute(
        'font-weight',
        '700'
      );

      title.setAttribute(
        'fill',
        '#111827'
      );

      title.textContent =
        this.getStructureTitle(this.focusedStructure);

      exportSvg.appendChild(title);

      const stats = document.createElementNS(
        namespace,
        'text'
      );

      stats.setAttribute(
        'x',
        `${bbox.x + bbox.width / 2}`
      );

      stats.setAttribute(
        'y',
        `${bbox.y - 42}`
      );

      stats.setAttribute(
        'text-anchor',
        'middle'
      );

      stats.setAttribute(
        'font-family',
        'Roboto, Helvetica Neue, Arial, sans-serif'
      );

      stats.setAttribute(
        'font-size',
        '15'
      );

      stats.setAttribute(
        'fill',
        '#6b7280'
      );

      stats.textContent =
        this.getStructureStats(this.focusedStructure);

      exportSvg.appendChild(stats);
    }

    const serialized =
      new XMLSerializer().serializeToString(exportSvg);

    const svgSource =
      `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;

    const blob = new Blob(
      [svgSource],
      {
        type: 'image/svg+xml;charset=utf-8'
      }
    );

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

    anchor.href = objectUrl;
    anchor.download =
      `correlation-monoliths-${timestamp}.svg`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      0
    );
  }

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

    this.viewTransform = d3.zoomIdentity;
    this.hierarchyAnchor = null;

    if (this.hasActiveData) {
      this.renderCombinedView(true);
    }
  }
}