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


/* ========================================================================== */
/* INTERNAL STRUCTURES                                                        */
/* ========================================================================== */

interface NormalizedEdge {

  source: string;

  target: string;

  correlation: number;
}


interface NPtychStructure {

  key: string;

  size: number;

  members: string[];

  edges: NormalizedEdge[];
}


/*
 * Jeden node vo vizuálnej hierarchii.
 *
 * pathId je unikátne podľa celej cesty.
 *
 * Rovnaký K3 teda môže byť:
 *
 * K5
 * ├── K4 ABCD
 * │   └── K3 ABC
 * │
 * └── K4 ABCE
 *     └── K3 ABC
 */
interface HierarchyViewNode {

  pathId: string;

  parentPathId: string | null;

  structure: NPtychStructure | null;

  virtualRoot: boolean;
}


/* ========================================================================== */
/* DETAIL GRAPH                                                               */
/* ========================================================================== */

interface DetailNode
  extends d3.SimulationNodeDatum {

  id: string;

  lines: string[];

  boxHeight: number;
}


interface DetailEdge
  extends d3.SimulationLinkDatum<DetailNode> {

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
  graphType: string = 'n-ptychs';


  /* ======================================================================== */
  /* CONFIGURATION                                                            */
  /* ======================================================================== */

  /*
   * N-ptychy vizualizujeme iba od K3 vyššie.
   */
  private readonly MIN_NPTYCH_SIZE = 3;


  /*
   * Hierarchy cards.
   */
  private readonly CARD_WIDTH = 190;

  private readonly CARD_HEIGHT = 165;

  private readonly HORIZONTAL_SPACING = 235;

  private readonly VERTICAL_SPACING = 225;


  /*
   * Detail graph nodes.
   */
  private readonly DETAIL_NODE_WIDTH = 190;

  private readonly ATTRIBUTE_LINE_LENGTH = 15;


  /* ======================================================================== */
  /* DATA                                                                     */
  /* ======================================================================== */

  private allStructures: NPtychStructure[] = [];


  private structureMap =
    new Map<string, NPtychStructure>();


  private structuresBySize =
    new Map<number, NPtychStructure[]>();


  private childrenCache =
    new Map<string, NPtychStructure[]>();


  private rootStructures: NPtychStructure[] = [];


  /* ======================================================================== */
  /* HIERARCHY STATE                                                          */
  /* ======================================================================== */

  private expandedPaths =
    new Set<string>();


  private selectedPathId:
    string | null = null;


  /*
   * Rozlišujeme:
   *
   * hierarchy
   * detail
   */
  private viewMode:
    'hierarchy' | 'detail' = 'hierarchy';


  /*
   * Aktuálne otvorený detail.
   */
  private focusedStructure:
    NPtychStructure | null = null;


  /* ======================================================================== */
  /* ANGULAR STATE                                                            */
  /* ======================================================================== */

  private viewInitialized = false;


  private resizeObserver?:
    ResizeObserver;


  /* ======================================================================== */
  /* D3 STATE                                                                 */
  /* ======================================================================== */

  /*
   * Hierarchia a detail majú vlastné kamery.
   *
   * Takže keď otvorím K4 a vrátim sa,
   * hierarchy ostane tam, kde som ju nechal.
   */
  private hierarchyTransform:
    d3.ZoomTransform =
      d3.zoomIdentity;


  private detailTransform:
    d3.ZoomTransform =
      d3.zoomIdentity;


  private detailSimulation?:
    d3.Simulation<
      DetailNode,
      DetailEdge
    >;


  /*
   * Potrebujeme rozlíšiť:
   *
   * click
   * double click
   */
  private clickTimer:
    number | null = null;


  /* ======================================================================== */
  /* ANGULAR                                                                  */
  /* ======================================================================== */

  ngAfterViewInit(): void {

    this.viewInitialized = true;


    this.resizeObserver =
      new ResizeObserver(() => {

        if (
          this.viewMode === 'detail' &&
          this.focusedStructure
        ) {

          this.renderStructureDetail(
            this.focusedStructure,
            false
          );

          return;
        }


        if (
          this.allStructures.length > 0
        ) {

          this.renderHierarchy(
            false
          );

        }

      });


    this.resizeObserver.observe(
      this.graphContainerRef.nativeElement
    );


    if (
      this.nPtychsData &&
      this.nPtychsData.length > 0
    ) {

      this.initializeAllData();

    }

  }


  ngOnChanges(
    changes: SimpleChanges
  ): void {

    if (!this.viewInitialized) {
      return;
    }


    /* ====================================================================== */
    /* NEW DATA                                                               */
    /* ====================================================================== */

    if (
      changes['nPtychsData']
    ) {

      if (
        this.nPtychsData &&
        this.nPtychsData.length > 0
      ) {

        this.initializeAllData();

      }
      else {

        this.clearCanvas();

      }

    }


    /* ====================================================================== */
    /* TAB CHANGE                                                             */
    /* ====================================================================== */

    if (
      changes['graphType']
    ) {

      if (
        this.graphType === 'n-ptychs' &&
        this.allStructures.length > 0
      ) {

        if (
          this.viewMode === 'detail' &&
          this.focusedStructure
        ) {

          this.renderStructureDetail(
            this.focusedStructure,
            false
          );

        }
        else {

          this.renderHierarchy(
            false
          );

        }

      }
      else {

        this.clearSvg();

      }

    }

  }


  ngOnDestroy(): void {

    this.resizeObserver?.disconnect();

    this.detailSimulation?.stop();


    if (
      this.clickTimer !== null
    ) {

      window.clearTimeout(
        this.clickTimer
      );

    }

  }


  /* ======================================================================== */
  /* DATA INITIALIZATION                                                      */
  /* ======================================================================== */

  private initializeAllData(): void {

    if (!this.nPtychsData) {
      return;
    }


    console.time(
      'N-PTYCH HIERARCHY INITIALIZATION'
    );


    /* ====================================================================== */
    /* RESET                                                                  */
    /* ====================================================================== */

    this.detailSimulation?.stop();


    this.allStructures = [];


    this.structureMap.clear();


    this.structuresBySize.clear();


    this.childrenCache.clear();


    this.rootStructures = [];


    this.expandedPaths.clear();


    this.selectedPathId = null;


    this.focusedStructure = null;


    this.viewMode =
      'hierarchy';


    /* ====================================================================== */
    /* NORMALIZE ALL N-PTYCHS                                                 */
    /* ====================================================================== */

    for (
      const apiStructure
      of this.nPtychsData
    ) {

      /*
       * K2 ignorujeme.
       */
      if (
        !apiStructure.nodes ||
        apiStructure.nodes.length <
          this.MIN_NPTYCH_SIZE
      ) {

        continue;

      }


      const members =
        [...apiStructure.nodes]
          .sort();


      const key =
        this.createStructureKey(
          members
        );


      /*
       * Duplicate protection.
       */
      if (
        this.structureMap.has(
          key
        )
      ) {

        continue;

      }


      const memberSet =
        new Set(
          members
        );


      const edges:
        NormalizedEdge[] =
        (
          apiStructure.edges ??
          []
        )

          .map(edge => ({

            source:
              this.getEndpointId(
                edge.source
              ),

            target:
              this.getEndpointId(
                edge.target
              ),

            correlation:
              edge.correlation

          }))

          .filter(edge =>

            memberSet.has(
              edge.source
            ) &&

            memberSet.has(
              edge.target
            )

          );


      const structure:
        NPtychStructure = {

        key,

        size:
          members.length,

        members,

        edges

      };


      this.structureMap.set(
        key,
        structure
      );


      this.allStructures.push(
        structure
      );

    }


    /* ====================================================================== */
    /* SORT                                                                   */
    /* ====================================================================== */

    this.allStructures.sort(
      (
        a,
        b
      ) => {

        if (
          a.size !== b.size
        ) {

          return (
            b.size -
            a.size
          );

        }


        return (
          a.key.localeCompare(
            b.key
          )
        );

      }
    );


    /* ====================================================================== */
    /* INDEX BY SIZE                                                          */
    /* ====================================================================== */

    for (
      const structure
      of this.allStructures
    ) {

      if (
        !this.structuresBySize.has(
          structure.size
        )
      ) {

        this.structuresBySize.set(
          structure.size,
          []
        );

      }


      this.structuresBySize
        .get(
          structure.size
        )
        ?.push(
          structure
        );

    }


    /* ====================================================================== */
    /* ROOTS                                                                  */
    /* ====================================================================== */

    this.rootStructures =
      this.findRootStructures();


    /*
     * Rooty otvoríme automaticky,
     * takže hneď vidíme ich direct children.
     */
    for (
      let index = 0;
      index <
      this.rootStructures.length;
      index++
    ) {

      const structure =
        this.rootStructures[
          index
        ];


      this.expandedPaths.add(
        this.createRootPath(
          structure,
          index
        )
      );

    }


    if (
      this.rootStructures.length > 0
    ) {

      this.selectedPathId =
        this.createRootPath(
          this.rootStructures[0],
          0
        );

    }


    /* ====================================================================== */
    /* DEBUG                                                                  */
    /* ====================================================================== */

    console.log(
      'ALL N-PTYCHS K3+:',
      this.allStructures.length
    );


    console.log(
      'ROOT STRUCTURES:',
      this.rootStructures
    );


    console.log(
      'LEVELS:',
      Array.from(
        this.structuresBySize.entries()
      )

        .sort(
          (
            a,
            b
          ) =>
            b[0] -
            a[0]
        )

        .map(
          (
            [
              size,
              values
            ]
          ) => ({

            size,

            count:
              values.length

          })
        )
    );


    console.timeEnd(
      'N-PTYCH HIERARCHY INITIALIZATION'
    );


    /* ====================================================================== */
    /* VIEW                                                                   */
    /* ====================================================================== */

    this.hierarchyTransform =
      d3.zoomIdentity;


    this.renderHierarchy(
      true
    );

  }


  /* ======================================================================== */
  /* ROOT STRUCTURES                                                          */
  /* ======================================================================== */

  private findRootStructures():
    NPtychStructure[] {

    const roots:
      NPtychStructure[] = [];


    for (
      const structure
      of this.allStructures
    ) {

      const parents =
        this.structuresBySize.get(
          structure.size + 1
        ) ?? [];


      const hasParent =
        parents.some(
          parent =>
            this.isSubset(
              structure.members,
              parent.members
            )
        );


      if (!hasParent) {

        roots.push(
          structure
        );

      }

    }


    return roots;

  }


  /* ======================================================================== */
  /* DIRECT CHILDREN                                                          */
  /* ======================================================================== */

  private getDirectChildren(
    parent: NPtychStructure
  ): NPtychStructure[] {

    /*
     * K3 je posledný level.
     */
    if (
      parent.size <=
      this.MIN_NPTYCH_SIZE
    ) {

      return [];

    }


    const cached =
      this.childrenCache.get(
        parent.key
      );


    if (cached) {

      return cached;

    }


    const childSize =
      parent.size - 1;


    if (
      childSize <
      this.MIN_NPTYCH_SIZE
    ) {

      return [];

    }


    const candidates =
      this.structuresBySize.get(
        childSize
      ) ?? [];


    const children =
      candidates

        .filter(
          child =>
            this.isSubset(
              child.members,
              parent.members
            )
        )

        .sort(
          (
            a,
            b
          ) =>
            a.key.localeCompare(
              b.key
            )
        );


    this.childrenCache.set(
      parent.key,
      children
    );


    return children;

  }


  /* ======================================================================== */
  /* VISIBLE HIERARCHY                                                        */
  /* ======================================================================== */

  private buildVisibleHierarchy():
    HierarchyViewNode {

    return {

      pathId:
        '__ROOT__',

      parentPathId:
        null,

      structure:
        null,

      virtualRoot:
        true

    };

  }


  private getVisibleChildren(
    node:
      HierarchyViewNode
  ):
    HierarchyViewNode[] |
    undefined {

    /* ====================================================================== */
    /* SYNTHETIC ROOT                                                         */
    /* ====================================================================== */

    if (
      node.virtualRoot
    ) {

      return this.rootStructures.map(
        (
          structure,
          index
        ) => ({

          pathId:
            this.createRootPath(
              structure,
              index
            ),

          parentPathId:
            '__ROOT__',

          structure,

          virtualRoot:
            false

        })
      );

    }


    if (
      !node.structure
    ) {

      return undefined;

    }


    /* ====================================================================== */
    /* COLLAPSED                                                              */
    /* ====================================================================== */

    if (
      !this.expandedPaths.has(
        node.pathId
      )
    ) {

      return undefined;

    }


    /* ====================================================================== */
    /* K3 = END                                                               */
    /* ====================================================================== */

    if (
      node.structure.size <=
      this.MIN_NPTYCH_SIZE
    ) {

      return undefined;

    }


    /* ====================================================================== */
    /* CHILDREN                                                               */
    /* ====================================================================== */

    const children =
      this.getDirectChildren(
        node.structure
      );


    if (
      children.length === 0
    ) {

      return undefined;

    }


    return children.map(
      child => ({

        pathId:
          `${node.pathId}>${child.key}`,

        parentPathId:
          node.pathId,

        structure:
          child,

        virtualRoot:
          false

      })
    );

  }


  /* ======================================================================== */
  /* SINGLE CLICK                                                             */
  /* ======================================================================== */

  private handleNodeClick(
    hierarchyNode:
      d3.HierarchyPointNode<
        HierarchyViewNode
      >
  ): void {

    const node =
      hierarchyNode.data;


    if (
      !node.structure
    ) {

      return;

    }


    this.selectedPathId =
      node.pathId;


    /*
     * K3 už iba označíme.
     */
    if (
      node.structure.size <=
      this.MIN_NPTYCH_SIZE
    ) {

      this.renderHierarchy(
        false
      );

      return;

    }


    /*
     * Root nechávame otvorený.
     *
     * Klik naň iba zatvorí
     * všetky hlbšie vetvy.
     */
    if (
      node.parentPathId ===
      '__ROOT__'
    ) {

      this.collapseDescendants(
        node.pathId
      );


      this.expandedPaths.add(
        node.pathId
      );


      this.renderHierarchy(
        false
      );

      return;

    }


    const expanded =
      this.expandedPaths.has(
        node.pathId
      );


    if (expanded) {

      this.collapsePath(
        node.pathId
      );


      this.renderHierarchy(
        false
      );

      return;

    }


    /*
     * Pri otvorení jednej vetvy
     * zavrieme siblings.
     */
    this.collapseSiblingBranches(
      node
    );


    this.expandedPaths.add(
      node.pathId
    );


    this.renderHierarchy(
      false
    );

  }


  /* ======================================================================== */
  /* DOUBLE CLICK / OPEN                                                      */
  /* ======================================================================== */

  private openStructureDetail(
    structure:
      NPtychStructure
  ): void {

    this.cancelPendingClick();


    this.focusedStructure =
      structure;


    this.viewMode =
      'detail';


    /*
     * Detail začne s vlastnou kamerou.
     */
    this.detailTransform =
      d3.zoomIdentity;


    this.renderStructureDetail(
      structure,
      true
    );

  }


  private closeStructureDetail():
    void {

    this.detailSimulation?.stop();


    this.focusedStructure =
      null;


    this.viewMode =
      'hierarchy';


    /*
     * hierarchyTransform sme nemenili,
     * takže sa vraciame presne tam,
     * kde sme predtým boli.
     */
    this.renderHierarchy(
      false
    );

  }


  /* ======================================================================== */
  /* CLICK TIMER                                                              */
  /* ======================================================================== */

  private scheduleSingleClick(
    node:
      d3.HierarchyPointNode<
        HierarchyViewNode
      >
  ): void {

    this.cancelPendingClick();


    this.clickTimer =
      window.setTimeout(
        () => {

          this.clickTimer =
            null;


          this.handleNodeClick(
            node
          );

        },
        220
      );

  }


  private cancelPendingClick():
    void {

    if (
      this.clickTimer !== null
    ) {

      window.clearTimeout(
        this.clickTimer
      );


      this.clickTimer =
        null;

    }

  }


  /* ======================================================================== */
  /* COLLAPSE                                                                 */
  /* ======================================================================== */

  private collapsePath(
    pathId:
      string
  ): void {

    const paths =
      Array.from(
        this.expandedPaths
      );


    for (
      const expandedPath
      of paths
    ) {

      if (
        expandedPath ===
          pathId ||

        expandedPath.startsWith(
          `${pathId}>`
        )
      ) {

        this.expandedPaths.delete(
          expandedPath
        );

      }

    }

  }


  private collapseDescendants(
    pathId:
      string
  ): void {

    const paths =
      Array.from(
        this.expandedPaths
      );


    for (
      const expandedPath
      of paths
    ) {

      if (
        expandedPath.startsWith(
          `${pathId}>`
        )
      ) {

        this.expandedPaths.delete(
          expandedPath
        );

      }

    }

  }


  private collapseSiblingBranches(
    node:
      HierarchyViewNode
  ): void {

    if (
      !node.parentPathId
    ) {

      return;

    }


    const paths =
      Array.from(
        this.expandedPaths
      );


    for (
      const expandedPath
      of paths
    ) {

      if (
        !expandedPath.startsWith(
          `${node.parentPathId}>`
        )
      ) {

        continue;

      }


      if (
        expandedPath ===
        node.pathId
      ) {

        continue;

      }


      const remaining =
        expandedPath.substring(
          node.parentPathId.length +
          1
        );


      /*
       * iba direct sibling
       */
      if (
        !remaining.includes(
          '>'
        )
      ) {

        this.collapsePath(
          expandedPath
        );

      }

    }

  }


  /* ======================================================================== */
  /* HIERARCHY RENDER                                                         */
  /* ======================================================================== */

  private renderHierarchy(
    resetView:
      boolean
  ): void {

    if (
      !this.svgRef ||
      !this.graphContainerRef ||
      this.allStructures.length === 0
    ) {

      return;

    }


    this.detailSimulation?.stop();


    const container =
      this.graphContainerRef
        .nativeElement;


    const width =
      container.clientWidth;


    const height =
      container.clientHeight;


    if (
      width <= 0 ||
      height <= 0
    ) {

      return;

    }


    const svg =
      d3
        .select(
          this.svgRef.nativeElement
        )

        .attr(
          'width',
          width
        )

        .attr(
          'height',
          height
        )

        .attr(
          'viewBox',
          `0 0 ${width} ${height}`
        );


    svg
      .selectAll('*')
      .remove();


    /* ====================================================================== */
    /* ARROW                                                                  */
    /* ====================================================================== */

    const defs =
      svg.append(
        'defs'
      );


    defs
      .append(
        'marker'
      )

      .attr(
        'id',
        'hierarchy-arrow'
      )

      .attr(
        'viewBox',
        '0 -5 10 10'
      )

      .attr(
        'refX',
        9
      )

      .attr(
        'refY',
        0
      )

      .attr(
        'markerWidth',
        7
      )

      .attr(
        'markerHeight',
        7
      )

      .attr(
        'orient',
        'auto'
      )

      .append(
        'path'
      )

      .attr(
        'd',
        'M0,-5L10,0L0,5'
      )

      .attr(
        'fill',
        '#9ca3af'
      );


    /* ====================================================================== */
    /* WORLD                                                                  */
    /* ====================================================================== */

    const world =
      svg
        .append(
          'g'
        )

        .attr(
          'class',
          'hierarchy-world'
        )

        .attr(
          'transform',
          this.hierarchyTransform
            .toString()
        );


    const linksGroup =
      world
        .append(
          'g'
        )

        .attr(
          'class',
          'hierarchy-links'
        );


    const nodesGroup =
      world
        .append(
          'g'
        )

        .attr(
          'class',
          'hierarchy-nodes'
        );


    /* ====================================================================== */
    /* ZOOM                                                                   */
    /* ====================================================================== */

    const zoomBehavior =
      d3
        .zoom<
          SVGSVGElement,
          unknown
        >()

        .scaleExtent(
          [
            0.15,
            5
          ]
        )

        .filter(
          (event: any) => {

            const target =
              event.target as
                Element |
                null;


            if (
              event.type ===
                'mousedown' &&

              target?.closest(
                '.hierarchy-card'
              )
            ) {

              return false;

            }


            return true;

          }
        )

        .on(
          'zoom',
          event => {

            this.hierarchyTransform =
              event.transform;


            world.attr(
              'transform',
              event.transform
                .toString()
            );

          }
        );


    svg.call(
      zoomBehavior
    );


    svg.on(
      'dblclick.zoom',
      null
    );


    /* ====================================================================== */
    /* DATA                                                                   */
    /* ====================================================================== */

    const hierarchyRoot =
      d3.hierarchy<
        HierarchyViewNode
      >(
        this.buildVisibleHierarchy(),

        node =>
          this.getVisibleChildren(
            node
          )
      );


    const treeLayout =
      d3
        .tree<
          HierarchyViewNode
        >()

        .nodeSize(
          [
            this.HORIZONTAL_SPACING,
            this.VERTICAL_SPACING
          ]
        );


    const pointRoot =
      treeLayout(
        hierarchyRoot
      );


    const visibleNodes =
      pointRoot
        .descendants()
        .filter(
          node =>
            !node.data
              .virtualRoot
        );


    const visibleLinks =
      pointRoot
        .links()
        .filter(
          link =>

            !link.source.data
              .virtualRoot &&

            !link.target.data
              .virtualRoot
        );


    /*
     * Synthetic root odstránime
     * vizuálnym offsetom.
     */
    const hierarchyYOffset =
      this.VERTICAL_SPACING;


    /* ====================================================================== */
    /* LINKS                                                                  */
    /* ====================================================================== */

    linksGroup
      .selectAll(
        'path'
      )

      .data(
        visibleLinks
      )

      .enter()

      .append(
        'path'
      )

      .attr(
        'fill',
        'none'
      )

      .attr(
        'stroke',
        '#c7cbd4'
      )

      .attr(
        'stroke-width',
        2
      )

      .attr(
        'marker-end',
        'url(#hierarchy-arrow)'
      )

      .attr(
        'd',
        link => {

          const sourceX =
            link.source.x;


          const sourceY =
            link.source.y -
            hierarchyYOffset +
            this.CARD_HEIGHT / 2;


          const targetX =
            link.target.x;


          const targetY =
            link.target.y -
            hierarchyYOffset -
            this.CARD_HEIGHT / 2;


          const middleY =
            (
              sourceY +
              targetY
            ) /
            2;


          return `
            M ${sourceX} ${sourceY}
            C ${sourceX} ${middleY},
              ${targetX} ${middleY},
              ${targetX} ${targetY}
          `;

        }
      );


    /* ====================================================================== */
    /* CARDS                                                                  */
    /* ====================================================================== */

    const cards =
      nodesGroup
        .selectAll<
          SVGGElement,
          d3.HierarchyPointNode<
            HierarchyViewNode
          >
        >(
          'g.hierarchy-card'
        )

        .data(
          visibleNodes,
          node =>
            node.data.pathId
        )

        .enter()

        .append(
          'g'
        )

        .attr(
          'class',
          'hierarchy-card'
        )

        .attr(
          'transform',
          node =>
            `translate(
              ${node.x},
              ${
                node.y -
                hierarchyYOffset
              }
            )`
        )

        .style(
          'cursor',
          'pointer'
        )


        /* ------------------------------------------------------------------ */
        /* SINGLE CLICK                                                       */
        /* ------------------------------------------------------------------ */

        .on(
          'click',
          (
            event,
            node
          ) => {

            event.stopPropagation();


            this.scheduleSingleClick(
              node
            );

          }
        )


        /* ------------------------------------------------------------------ */
        /* DOUBLE CLICK                                                       */
        /* ------------------------------------------------------------------ */

        .on(
          'dblclick',
          (
            event,
            node
          ) => {

            event.preventDefault();

            event.stopPropagation();


            this.cancelPendingClick();


            if (
              node.data.structure
            ) {

              this.openStructureDetail(
                node.data.structure
              );

            }

          }
        );


    /* ====================================================================== */
    /* SHADOW                                                                 */
    /* ====================================================================== */

    cards
      .append(
        'rect'
      )

      .attr(
        'x',
        -this.CARD_WIDTH / 2 +
        3
      )

      .attr(
        'y',
        -this.CARD_HEIGHT / 2 +
        4
      )

      .attr(
        'width',
        this.CARD_WIDTH
      )

      .attr(
        'height',
        this.CARD_HEIGHT
      )

      .attr(
        'rx',
        12
      )

      .attr(
        'fill',
        'rgba(0,0,0,0.06)'
      );


    /* ====================================================================== */
    /* CARD                                                                   */
    /* ====================================================================== */

    cards
      .append(
        'rect'
      )

      .attr(
        'x',
        -this.CARD_WIDTH / 2
      )

      .attr(
        'y',
        -this.CARD_HEIGHT / 2
      )

      .attr(
        'width',
        this.CARD_WIDTH
      )

      .attr(
        'height',
        this.CARD_HEIGHT
      )

      .attr(
        'rx',
        12
      )

      .attr(
        'fill',
        node =>

          node.data.pathId ===
          this.selectedPathId

            ? '#eef2ff'
            : '#ffffff'
      )

      .attr(
        'stroke',
        node =>

          node.data.pathId ===
          this.selectedPathId

            ? '#3f51b5'
            : '#d9dde5'
      )

      .attr(
        'stroke-width',
        node =>

          node.data.pathId ===
          this.selectedPathId

            ? 2.5
            : 1.5
      );


    /* ====================================================================== */
    /* K TITLE                                                                */
    /* ====================================================================== */

    cards
      .append(
        'text'
      )

      .attr(
        'x',
        -this.CARD_WIDTH / 2 +
        14
      )

      .attr(
        'y',
        -this.CARD_HEIGHT / 2 +
        23
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        15
      )

      .attr(
        'font-weight',
        700
      )

      .attr(
        'fill',
        '#111827'
      )

      .text(
        node =>
          `K${
            node.data.structure
              ?.size ?? 0
          }`
      );


    /* ====================================================================== */
    /* STATS                                                                  */
    /* ====================================================================== */

    cards
      .append(
        'text'
      )

      .attr(
        'x',
        -this.CARD_WIDTH / 2 +
        14
      )

      .attr(
        'y',
        -this.CARD_HEIGHT / 2 +
        41
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        10
      )

      .attr(
        'fill',
        '#9ca3af'
      )

      .text(
        node => {

          const structure =
            node.data.structure;


          if (!structure) {
            return '';
          }


          return (
            `${structure.size} vrcholov · ` +
            `${structure.edges.length} hrán`
          );

        }
      );


    /* ====================================================================== */
    /* EXPAND BUTTON                                                          */
    /* ====================================================================== */

    const expandable =
      cards.filter(
        node => {

          if (
            !node.data.structure
          ) {

            return false;

          }


          return (
            this.getDirectChildren(
              node.data.structure
            ).length > 0
          );

        }
      );


    expandable
      .append(
        'circle'
      )

      .attr(
        'cx',
        this.CARD_WIDTH / 2 -
        20
      )

      .attr(
        'cy',
        -this.CARD_HEIGHT / 2 +
        22
      )

      .attr(
        'r',
        11
      )

      .attr(
        'fill',
        node =>

          this.expandedPaths.has(
            node.data.pathId
          )

            ? '#3f51b5'
            : '#eef2ff'
      )

      .attr(
        'stroke',
        '#3f51b5'
      );


    expandable
      .append(
        'text'
      )

      .attr(
        'x',
        this.CARD_WIDTH / 2 -
        20
      )

      .attr(
        'y',
        -this.CARD_HEIGHT / 2 +
        26
      )

      .attr(
        'text-anchor',
        'middle'
      )

      .attr(
        'font-size',
        16
      )

      .attr(
        'font-weight',
        600
      )

      .attr(
        'fill',
        node =>

          this.expandedPaths.has(
            node.data.pathId
          )

            ? '#ffffff'
            : '#3f51b5'
      )

      .text(
        node =>

          this.expandedPaths.has(
            node.data.pathId
          )

            ? '−'
            : '+'
      );


    /* ====================================================================== */
    /* MINI GRAPH                                                             */
    /* ====================================================================== */

    cards.each(
      (
        hierarchyNode,
        index,
        elements
      ) => {

        const structure =
          hierarchyNode
            .data
            .structure;


        if (!structure) {
          return;
        }


        const card =
          d3.select(
            elements[
              index
            ] as SVGGElement
          );


        this.drawMiniGraph(
          card,
          structure
        );

      }
    );


    /* ====================================================================== */
    /* OPEN BUTTON                                                            */
    /* ====================================================================== */

    const openButtons =
      cards
        .append(
          'g'
        )

        .attr(
          'class',
          'open-structure-button'
        )

        .attr(
          'transform',
          `translate(
            ${
              this.CARD_WIDTH / 2 -
              48
            },
            ${
              this.CARD_HEIGHT / 2 -
              19
            }
          )`
        )

        .style(
          'cursor',
          'pointer'
        )

        .on(
          'click',
          (
            event,
            node
          ) => {

            event.stopPropagation();


            this.cancelPendingClick();


            if (
              node.data.structure
            ) {

              this.openStructureDetail(
                node.data.structure
              );

            }

          }
        );


    openButtons
      .append(
        'rect'
      )

      .attr(
        'x',
        -36
      )

      .attr(
        'y',
        -11
      )

      .attr(
        'width',
        72
      )

      .attr(
        'height',
        22
      )

      .attr(
        'rx',
        6
      )

      .attr(
        'fill',
        '#eef2ff'
      )

      .attr(
        'stroke',
        '#c7cdf8'
      );


    openButtons
      .append(
        'text'
      )

      .attr(
        'x',
        0
      )

      .attr(
        'y',
        4
      )

      .attr(
        'text-anchor',
        'middle'
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        10
      )

      .attr(
        'font-weight',
        600
      )

      .attr(
        'fill',
        '#3f51b5'
      )

      .text(
        'Otvoriť'
      );


    /* ====================================================================== */
    /* MEMBERS                                                                */
    /* ====================================================================== */

    cards
      .append(
        'text'
      )

      .attr(
        'x',
        -this.CARD_WIDTH / 2 +
        14
      )

      .attr(
        'y',
        this.CARD_HEIGHT / 2 -
        14
      )

      .attr(
        'text-anchor',
        'start'
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        9
      )

      .attr(
        'fill',
        '#6b7280'
      )

      .text(
        node =>

          this.formatMemberList(
            node.data.structure
              ?.members ?? []
          )
      );


    /* ====================================================================== */
    /* TOOLTIP                                                                */
    /* ====================================================================== */

    cards
      .append(
        'title'
      )

      .text(
        node => {

          const structure =
            node.data.structure;


          if (!structure) {
            return '';
          }


          return (
            `K${structure.size}\n` +
            structure.members.join(
              '\n'
            ) +
            '\n\nDvojklikom otvor graf'
          );

        }
      );


    /* ====================================================================== */
    /* INFO                                                                   */
    /* ====================================================================== */

    const help =
      svg
        .append(
          'text'
        )

        .attr(
          'x',
          20
        )

        .attr(
          'y',
          height - 20
        )

        .attr(
          'font-family',
          'Roboto, Helvetica Neue, sans-serif'
        )

        .attr(
          'font-size',
          11
        )

        .attr(
          'fill',
          '#9ca3af'
        )

        .text(
          'Klik = rozbaliť · Dvojklik = otvoriť graf · Koliesko = zoom · Drag pozadia = pohyb'
        );


    help
      .style(
        'pointer-events',
        'none'
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
        hierarchyYOffset
      );

    }

  }


  /* ======================================================================== */
  /* MINI GRAPH                                                               */
  /* ======================================================================== */

  private drawMiniGraph(
    card:
      d3.Selection<
        SVGGElement,
        any,
        any,
        any
      >,

    structure:
      NPtychStructure
  ): void {

    const graph =
      card
        .append(
          'g'
        )

        .attr(
          'class',
          'mini-graph'
        );


    const centerX =
      0;


    const centerY =
      10;


    const radius =
      30;


    const positions =
      new Map<
        string,
        {
          x: number;
          y: number;
        }
      >();


    structure.members.forEach(
      (
        member,
        index
      ) => {

        const angle =
          (
            2 *
            Math.PI *
            index
          ) /
          structure.members.length
          -
          Math.PI / 2;


        positions.set(
          member,
          {

            x:
              centerX +
              Math.cos(
                angle
              ) *
              radius,

            y:
              centerY +
              Math.sin(
                angle
              ) *
              radius

          }
        );

      }
    );


    /* ====================================================================== */
    /* EDGES                                                                  */
    /* ====================================================================== */

    graph
      .selectAll(
        'line'
      )

      .data(
        structure.edges
      )

      .enter()

      .append(
        'line'
      )

      .attr(
        'x1',
        edge =>
          positions.get(
            edge.source
          )?.x ?? 0
      )

      .attr(
        'y1',
        edge =>
          positions.get(
            edge.source
          )?.y ?? 0
      )

      .attr(
        'x2',
        edge =>
          positions.get(
            edge.target
          )?.x ?? 0
      )

      .attr(
        'y2',
        edge =>
          positions.get(
            edge.target
          )?.y ?? 0
      )

      .attr(
        'stroke',
        edge =>

          edge.correlation >= 0

            ? '#6574d9'
            : '#d96b6b'
      )

      .attr(
        'stroke-width',
        edge =>

          1 +
          Math.abs(
            edge.correlation
          ) *
          1.2
      )

      .attr(
        'stroke-opacity',
        0.75
      );


    /* ====================================================================== */
    /* NODES                                                                  */
    /* ====================================================================== */

    graph
      .selectAll(
        'circle'
      )

      .data(
        structure.members
      )

      .enter()

      .append(
        'circle'
      )

      .attr(
        'cx',
        member =>
          positions.get(
            member
          )?.x ?? 0
      )

      .attr(
        'cy',
        member =>
          positions.get(
            member
          )?.y ?? 0
      )

      .attr(
        'r',
        6
      )

      .attr(
        'fill',
        '#ffffff'
      )

      .attr(
        'stroke',
        '#3f51b5'
      )

      .attr(
        'stroke-width',
        2
      );

  }


  /* ======================================================================== */
  /* DETAIL VIEW                                                              */
  /* ======================================================================== */

  private renderStructureDetail(
    structure:
      NPtychStructure,

    resetView:
      boolean
  ): void {

    if (
      !this.svgRef ||
      !this.graphContainerRef
    ) {

      return;

    }


    this.detailSimulation?.stop();


    const container =
      this.graphContainerRef
        .nativeElement;


    const width =
      container.clientWidth;


    const height =
      container.clientHeight;


    if (
      width <= 0 ||
      height <= 0
    ) {

      return;

    }


    if (resetView) {

      this.detailTransform =
        d3.zoomIdentity;

    }


    const svg =
      d3
        .select(
          this.svgRef.nativeElement
        )

        .attr(
          'width',
          width
        )

        .attr(
          'height',
          height
        )

        .attr(
          'viewBox',
          `0 0 ${width} ${height}`
        );


    svg
      .selectAll('*')
      .remove();


    /* ====================================================================== */
    /* DATA                                                                   */
    /* ====================================================================== */

    const nodes:
      DetailNode[] =
      structure.members.map(
        member => {

          const lines =
            this.wrapAttributeLabel(
              member,
              this.ATTRIBUTE_LINE_LENGTH
            );


          return {

            id:
              member,

            lines,

            boxHeight:
              Math.max(
                64,
                30 +
                lines.length *
                18
              )

          };

        }
      );


    const edges:
      DetailEdge[] =
      structure.edges.map(
        edge => ({

          source:
            edge.source,

          target:
            edge.target,

          correlation:
            edge.correlation

        })
      );


    /* ====================================================================== */
    /* WORLD                                                                  */
    /* ====================================================================== */

    const world =
      svg
        .append(
          'g'
        )

        .attr(
          'class',
          'detail-world'
        )

        .attr(
          'transform',
          this.detailTransform
            .toString()
        );


    const linksGroup =
      world
        .append(
          'g'
        )

        .attr(
          'class',
          'detail-links'
        );


    const labelsGroup =
      world
        .append(
          'g'
        )

        .attr(
          'class',
          'detail-edge-labels'
        );


    const nodesGroup =
      world
        .append(
          'g'
        )

        .attr(
          'class',
          'detail-nodes'
        );


    /* ====================================================================== */
    /* ZOOM / PAN                                                             */
    /* ====================================================================== */

    const zoomBehavior =
      d3
        .zoom<
          SVGSVGElement,
          unknown
        >()

        .scaleExtent(
          [
            0.2,
            6
          ]
        )

        .filter(
          (event: any) => {

            const target =
              event.target as
                Element |
                null;


            if (
              event.type ===
                'mousedown' &&

              target?.closest(
                '.detail-node'
              )
            ) {

              return false;

            }


            return true;

          }
        )

        .on(
          'zoom',
          event => {

            this.detailTransform =
              event.transform;


            world.attr(
              'transform',
              event.transform
                .toString()
            );

          }
        );


    svg.call(
      zoomBehavior
    );


    svg.on(
      'dblclick.zoom',
      null
    );


    /* ====================================================================== */
    /* EDGES                                                                  */
    /* ====================================================================== */

    const links =
      linksGroup
        .selectAll<
          SVGLineElement,
          DetailEdge
        >(
          'line'
        )

        .data(
          edges
        )

        .enter()

        .append(
          'line'
        )

        .attr(
          'stroke',
          edge =>

            edge.correlation >= 0

              ? '#596bd8'
              : '#d45f5f'
        )

        .attr(
          'stroke-width',
          edge =>

            2 +
            Math.abs(
              edge.correlation
            ) *
            2
        )

        .attr(
          'stroke-opacity',
          0.72
        );


    /* ====================================================================== */
    /* CORRELATION LABELS                                                     */
    /* ====================================================================== */

    const edgeLabels =
      labelsGroup
        .selectAll<
          SVGTextElement,
          DetailEdge
        >(
          'text'
        )

        .data(
          edges
        )

        .enter()

        .append(
          'text'
        )

        .attr(
          'text-anchor',
          'middle'
        )

        .attr(
          'dominant-baseline',
          'central'
        )

        .attr(
          'font-family',
          'JetBrains Mono, Consolas, monospace'
        )

        .attr(
          'font-size',
          11
        )

        .attr(
          'font-weight',
          600
        )

        .attr(
          'fill',
          '#4b5563'
        )

        /*
         * White outline pod textom.
         */
        .attr(
          'paint-order',
          'stroke'
        )

        .attr(
          'stroke',
          '#ffffff'
        )

        .attr(
          'stroke-width',
          5
        )

        .attr(
          'stroke-linejoin',
          'round'
        )

        .text(
          edge =>
            edge.correlation
              .toFixed(
                2
              )
        );


    /* ====================================================================== */
    /* DETAIL NODES                                                           */
    /* ====================================================================== */

    const nodeGroups =
      nodesGroup
        .selectAll<
          SVGGElement,
          DetailNode
        >(
          'g.detail-node'
        )

        .data(
          nodes
        )

        .enter()

        .append(
          'g'
        )

        .attr(
          'class',
          'detail-node'
        )

        .style(
          'cursor',
          'grab'
        );


    /* ====================================================================== */
    /* NODE SHADOW                                                            */
    /* ====================================================================== */

    nodeGroups
      .append(
        'rect'
      )

      .attr(
        'x',
        -this.DETAIL_NODE_WIDTH /
        2 +
        3
      )

      .attr(
        'y',
        node =>
          -node.boxHeight /
          2 +
          4
      )

      .attr(
        'width',
        this.DETAIL_NODE_WIDTH
      )

      .attr(
        'height',
        node =>
          node.boxHeight
      )

      .attr(
        'rx',
        10
      )

      .attr(
        'fill',
        'rgba(0,0,0,0.08)'
      );


    /* ====================================================================== */
    /* NODE RECTANGLE                                                         */
    /* ====================================================================== */

    nodeGroups
      .append(
        'rect'
      )

      .attr(
        'x',
        -this.DETAIL_NODE_WIDTH /
        2
      )

      .attr(
        'y',
        node =>
          -node.boxHeight /
          2
      )

      .attr(
        'width',
        this.DETAIL_NODE_WIDTH
      )

      .attr(
        'height',
        node =>
          node.boxHeight
      )

      .attr(
        'rx',
        10
      )

      .attr(
        'fill',
        '#ffffff'
      )

      .attr(
        'stroke',
        '#3f51b5'
      )

      .attr(
        'stroke-width',
        2.5
      );


    /* ====================================================================== */
    /* ATTRIBUTE TEXT                                                         */
    /* ====================================================================== */

    nodeGroups.each(
      (
        node,
        index,
        elements
      ) => {

        const group =
          d3.select(
            elements[
              index
            ] as SVGGElement
          );


        const text =
          group
            .append(
              'text'
            )

            .attr(
              'text-anchor',
              'middle'
            )

            .attr(
              'font-family',
              'Roboto, Helvetica Neue, sans-serif'
            )

            .attr(
              'font-size',
              13
            )

            .attr(
              'font-weight',
              600
            )

            .attr(
              'fill',
              '#1f2937'
            );


        const lineHeight =
          18;


        const totalHeight =
          (
            node.lines.length -
            1
          ) *
          lineHeight;


        node.lines.forEach(
          (
            line,
            lineIndex
          ) => {

            text
              .append(
                'tspan'
              )

              .attr(
                'x',
                0
              )

              .attr(
                'y',
                (
                  lineIndex *
                  lineHeight
                ) -
                totalHeight /
                2 +
                4
              )

              .text(
                line
              );

          }
        );

      }
    );


    /* ====================================================================== */
    /* FORCE SIMULATION                                                       */
    /* ====================================================================== */

    this.detailSimulation =
      d3
        .forceSimulation<
          DetailNode
        >(
          nodes
        )

        .force(
          'link',

          d3
            .forceLink<
              DetailNode,
              DetailEdge
            >(
              edges
            )

            .id(
              node =>
                node.id
            )

            .distance(
              240
            )

            .strength(
              0.6
            )
        )

        .force(
          'charge',

          d3
            .forceManyBody()
            .strength(
              -900
            )
        )

        .force(
          'center',

          d3.forceCenter(
            width / 2,
            height / 2
          )
        )

        .force(
          'collision',

          d3
            .forceCollide<
              DetailNode
            >()

            .radius(
              node => {

                const halfWidth =
                  this.DETAIL_NODE_WIDTH /
                  2;


                const halfHeight =
                  node.boxHeight /
                  2;


                return (
                  Math.sqrt(
                    halfWidth *
                    halfWidth +
                    halfHeight *
                    halfHeight
                  ) +
                  25
                );

              }
            )
        );


    /* ====================================================================== */
    /* DRAG                                                                   */
    /* ====================================================================== */

    const dragBehavior =
      d3
        .drag<
          SVGGElement,
          DetailNode
        >()

        .on(
          'start',
          (
            event,
            node
          ) => {

            if (
              !event.active
            ) {

              this.detailSimulation
                ?.alphaTarget(
                  0.3
                )
                .restart();

            }


            node.fx =
              node.x;


            node.fy =
              node.y;

          }
        )

        .on(
          'drag',
          (
            event,
            node
          ) => {

            node.fx =
              event.x;


            node.fy =
              event.y;

          }
        )

        .on(
          'end',
          (
            event,
            node
          ) => {

            if (
              !event.active
            ) {

              this.detailSimulation
                ?.alphaTarget(
                  0
                );

            }


            node.fx =
              null;


            node.fy =
              null;

          }
        );


    nodeGroups.call(
      dragBehavior
    );


    /* ====================================================================== */
    /* TICK                                                                   */
    /* ====================================================================== */

    this.detailSimulation.on(
      'tick',
      () => {

        links

          .attr(
            'x1',
            edge =>
              (
                edge.source as
                DetailNode
              ).x ?? 0
          )

          .attr(
            'y1',
            edge =>
              (
                edge.source as
                DetailNode
              ).y ?? 0
          )

          .attr(
            'x2',
            edge =>
              (
                edge.target as
                DetailNode
              ).x ?? 0
          )

          .attr(
            'y2',
            edge =>
              (
                edge.target as
                DetailNode
              ).y ?? 0
          );


        edgeLabels

          .attr(
            'x',
            edge => {

              const source =
                edge.source as
                DetailNode;


              const target =
                edge.target as
                DetailNode;


              return (
                (
                  (
                    source.x ??
                    0
                  ) +
                  (
                    target.x ??
                    0
                  )
                ) /
                2
              );

            }
          )

          .attr(
            'y',
            edge => {

              const source =
                edge.source as
                DetailNode;


              const target =
                edge.target as
                DetailNode;


              return (
                (
                  (
                    source.y ??
                    0
                  ) +
                  (
                    target.y ??
                    0
                  )
                ) /
                2
              );

            }
          );


        nodeGroups
          .attr(
            'transform',
            node =>
              `translate(
                ${node.x ?? 0},
                ${node.y ?? 0}
              )`
          );

      }
    );


    /* ====================================================================== */
    /* FIXED HEADER                                                           */
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
    svg:
      d3.Selection<
        SVGSVGElement,
        unknown,
        null,
        undefined
      >,

    structure:
      NPtychStructure,

    width:
      number
  ): void {

    const controls =
      svg
        .append(
          'g'
        )

        .attr(
          'class',
          'detail-controls'
        );


    /* ====================================================================== */
    /* BACK BUTTON                                                            */
    /* ====================================================================== */

    const backButton =
      controls
        .append(
          'g'
        )

        .attr(
          'transform',
          'translate(24, 26)'
        )

        .style(
          'cursor',
          'pointer'
        )

        .on(
          'click',
          event => {

            event.stopPropagation();


            this.closeStructureDetail();

          }
        );


    backButton
      .append(
        'rect'
      )

      .attr(
        'x',
        0
      )

      .attr(
        'y',
        0
      )

      .attr(
        'width',
        118
      )

      .attr(
        'height',
        36
      )

      .attr(
        'rx',
        8
      )

      .attr(
        'fill',
        '#ffffff'
      )

      .attr(
        'stroke',
        '#d1d5db'
      );


    backButton
      .append(
        'text'
      )

      .attr(
        'x',
        59
      )

      .attr(
        'y',
        23
      )

      .attr(
        'text-anchor',
        'middle'
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        12
      )

      .attr(
        'font-weight',
        600
      )

      .attr(
        'fill',
        '#374151'
      )

      .text(
        '← Hierarchia'
      );


    /* ====================================================================== */
    /* TITLE                                                                  */
    /* ====================================================================== */

    controls
      .append(
        'text'
      )

      .attr(
        'x',
        width / 2
      )

      .attr(
        'y',
        38
      )

      .attr(
        'text-anchor',
        'middle'
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        20
      )

      .attr(
        'font-weight',
        700
      )

      .attr(
        'fill',
        '#111827'
      )

      .text(
        `K${structure.size}`
      );


    controls
      .append(
        'text'
      )

      .attr(
        'x',
        width / 2
      )

      .attr(
        'y',
        56
      )

      .attr(
        'text-anchor',
        'middle'
      )

      .attr(
        'font-family',
        'Roboto, Helvetica Neue, sans-serif'
      )

      .attr(
        'font-size',
        11
      )

      .attr(
        'fill',
        '#6b7280'
      )

      .text(
        `${structure.size} vrcholov · ${structure.edges.length} hrán`
      );

  }


  /* ======================================================================== */
  /* ATTRIBUTE WORD WRAPPING                                                  */
  /* ======================================================================== */

  /*
   * Príklad:
   *
   * strong_negative_correlation
   *
   * ->
   *
   * strong_negative_
   * correlation
   *
   *
   * Ak neexistuje vhodný "_" alebo "-",
   * rozsekne ho tvrdo po 15 znakoch.
   */
  private wrapAttributeLabel(
    value:
      string,

    maxLength:
      number
  ): string[] {

    if (
      value.length <=
      maxLength
    ) {

      return [
        value
      ];

    }


    const lines:
      string[] = [];


    let remaining =
      value;


    while (
      remaining.length >
      maxLength
    ) {

      let splitIndex =
        maxLength;


      /*
       * Skúsime nájsť prirodzené
       * miesto na zalomenie.
       */
      for (
        let index =
          maxLength - 1;

        index >=
          Math.floor(
            maxLength / 2
          );

        index--
      ) {

        const char =
          remaining[
            index
          ];


        if (
          char === '_' ||
          char === '-' ||
          char === ' '
        ) {

          splitIndex =
            index + 1;


          break;

        }

      }


      const line =
        remaining
          .substring(
            0,
            splitIndex
          )
          .trim();


      if (
        line.length > 0
      ) {

        lines.push(
          line
        );

      }


      remaining =
        remaining
          .substring(
            splitIndex
          )
          .trim();

    }


    if (
      remaining.length > 0
    ) {

      lines.push(
        remaining
      );

    }


    return lines;

  }


  /* ======================================================================== */
  /* FIT HIERARCHY                                                            */
  /* ======================================================================== */

  private fitHierarchyToView(
    svg:
      d3.Selection<
        SVGSVGElement,
        unknown,
        null,
        undefined
      >,

    zoomBehavior:
      d3.ZoomBehavior<
        SVGSVGElement,
        unknown
      >,

    nodes:
      d3.HierarchyPointNode<
        HierarchyViewNode
      >[],

    width:
      number,

    height:
      number,

    yOffset:
      number
  ): void {

    if (
      nodes.length === 0
    ) {

      return;

    }


    const xValues =
      nodes.map(
        node =>
          node.x
      );


    const yValues =
      nodes.map(
        node =>
          node.y -
          yOffset
      );


    const minX =
      Math.min(
        ...xValues
      ) -
      this.CARD_WIDTH /
      2;


    const maxX =
      Math.max(
        ...xValues
      ) +
      this.CARD_WIDTH /
      2;


    const minY =
      Math.min(
        ...yValues
      ) -
      this.CARD_HEIGHT /
      2;


    const maxY =
      Math.max(
        ...yValues
      ) +
      this.CARD_HEIGHT /
      2;


    const hierarchyWidth =
      Math.max(
        1,
        maxX -
        minX
      );


    const hierarchyHeight =
      Math.max(
        1,
        maxY -
        minY
      );


    const padding =
      100;


    const scaleX =
      (
        width -
        padding
      ) /
      hierarchyWidth;


    const scaleY =
      (
        height -
        padding
      ) /
      hierarchyHeight;


    const scale =
      Math.max(
        0.3,

        Math.min(
          1,
          scaleX,
          scaleY
        )
      );


    const centerX =
      (
        minX +
        maxX
      ) /
      2;


    const centerY =
      (
        minY +
        maxY
      ) /
      2;


    const transform =
      d3
        .zoomIdentity

        .translate(
          width / 2,
          height / 2
        )

        .scale(
          scale
        )

        .translate(
          -centerX,
          -centerY
        );


    this.hierarchyTransform =
      transform;


    svg.call(
      zoomBehavior.transform,
      transform
    );

  }


  /* ======================================================================== */
  /* HELPERS                                                                  */
  /* ======================================================================== */

  private createStructureKey(
    members:
      string[]
  ): string {

    return (
      [...members]
        .sort()
        .join(
          '|'
        )
    );

  }


  private createRootPath(
    structure:
      NPtychStructure,

    index:
      number
  ): string {

    return (
      `ROOT-${index}-${structure.key}`
    );

  }


  private isSubset(
    smaller:
      string[],

    larger:
      string[]
  ): boolean {

    if (
      smaller.length >=
      larger.length
    ) {

      return false;

    }


    const largerSet =
      new Set(
        larger
      );


    return smaller.every(
      item =>
        largerSet.has(
          item
        )
    );

  }


  private getEndpointId(
    endpoint:
      string |
      {
        id?: string;
      }
  ): string {

    if (
      typeof endpoint ===
      'string'
    ) {

      return endpoint;

    }


    return (
      endpoint.id ??
      ''
    );

  }


  private formatMemberList(
    members:
      string[]
  ): string {

    const text =
      members.join(
        ' · '
      );


    const maximum =
      19;


    if (
      text.length <=
      maximum
    ) {

      return text;

    }


    return (
      text.substring(
        0,
        maximum - 3
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
      .select(
        this.svgRef.nativeElement
      )

      .selectAll('*')
      .remove();

  }


  private clearCanvas(): void {

    this.clearSvg();


    this.allStructures = [];


    this.structureMap.clear();


    this.structuresBySize.clear();


    this.childrenCache.clear();


    this.rootStructures = [];


    this.expandedPaths.clear();


    this.selectedPathId =
      null;


    this.focusedStructure =
      null;


    this.viewMode =
      'hierarchy';


    this.hierarchyTransform =
      d3.zoomIdentity;


    this.detailTransform =
      d3.zoomIdentity;

  }


  /* ======================================================================== */
  /* RESET VIEW                                                               */
  /* ======================================================================== */

  public resetView(): void {

    if (
      this.viewMode === 'detail' &&
      this.focusedStructure
    ) {

      this.detailTransform =
        d3.zoomIdentity;


      this.renderStructureDetail(
        this.focusedStructure,
        true
      );


      return;

    }


    this.hierarchyTransform =
      d3.zoomIdentity;


    if (
      this.allStructures.length > 0
    ) {

      this.renderHierarchy(
        true
      );

    }

  }

}