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


export type GraphType =
  | 'n-ptychs'
  | 'paths'
  | 'hotspots';


interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
}


interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  correlation: number;
}


interface GraphData {
  nodes: Array<{
    id: string;
  }>;

  edges: Array<{
    source: string;
    target: string;
    correlation: number;
  }>;
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
  graphType: GraphType = 'n-ptychs';


  @Input()
  graphData: GraphData | null = null;


  private viewInitialized = false;

  private simulation?: d3.Simulation<GraphNode, GraphEdge>;

  private resizeObserver?: ResizeObserver;


  ngAfterViewInit(): void {

  this.viewInitialized = true;

  this.resizeObserver = new ResizeObserver(() => {

    if (this.graphData) {
      this.renderGraph();
    }

  });


  this.resizeObserver.observe(
    this.graphContainerRef.nativeElement
  );


  if (this.graphData) {
    this.renderGraph();
  }
}


  ngOnChanges(
  changes: SimpleChanges
): void {

  if (!this.viewInitialized) {
    return;
  }


  if (
    changes['graphData'] ||
    changes['graphType']
  ) {

    if (this.graphData) {

      this.renderGraph();

    }
    else {

      this.clearGraph();

    }

  }
}


  ngOnDestroy(): void {

    this.simulation?.stop();

    this.resizeObserver?.disconnect();
  }


  private clearGraph(): void {

    if (!this.svgRef) {
      return;
    }

    d3.select(this.svgRef.nativeElement)
      .selectAll('*')
      .remove();
  }


  private renderGraph(): void {

    if (
      !this.graphData ||
      !this.svgRef ||
      !this.graphContainerRef
    ) {
      return;
    }


    const container =
      this.graphContainerRef.nativeElement;

    const width = container.clientWidth;
    const height = container.clientHeight;


    if (width <= 0 || height <= 0) {
      return;
    }


    /*
     * D3 forceLink mutuje nodes a edges.
     *
     * Preto si vždy vytvoríme vlastné kópie
     * a nemeníme response uloženú v AppComponent.
     */
    const nodes: GraphNode[] =
      this.graphData.nodes.map(node => ({
        id: node.id
      }));


    const edges: GraphEdge[] =
      this.graphData.edges.map(edge => ({
        source: edge.source,
        target: edge.target,
        correlation: edge.correlation
      }));


    /*
     * Zastavíme predchádzajúcu simulation,
     * ak sa dataset zmenil.
     */
    this.simulation?.stop();


    const svg = d3
      .select(this.svgRef.nativeElement)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);


    svg
      .selectAll('*')
      .remove();


    /*
     * Všetko kreslíme do jednej world group.
     *
     * Zoom/pan transformuje iba túto group.
     */
    const world = svg
      .append('g')
      .attr('class', 'graph-world');


    const linksGroup = world
      .append('g')
      .attr('class', 'links');


    const labelsGroup = world
      .append('g')
      .attr('class', 'edge-labels');


    const nodesGroup = world
      .append('g')
      .attr('class', 'nodes');


    /*
     * ------------------------------------------------------------------------
     * ZOOM + PAN
     * ------------------------------------------------------------------------
     */

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 8])
      .on('zoom', event => {

        world.attr(
          'transform',
          event.transform.toString()
        );

      });


    svg.call(zoomBehavior);


    /*
     * Double click by default zoomuje.
     * Zatiaľ to vypneme, nech sa canvas správa pokojnejšie.
     */
    svg.on('dblclick.zoom', null);


    /*
     * ------------------------------------------------------------------------
     * LINKS
     * ------------------------------------------------------------------------
     */

    const links = linksGroup
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('class', 'graph-link')
      .attr(
        'stroke',
        edge =>
          edge.correlation >= 0
            ? '#4f63d8'
            : '#d9534f'
      )
      .attr(
        'stroke-width',
        edge =>
          1.5 + Math.abs(edge.correlation) * 2
      )
      .attr(
        'stroke-opacity',
        edge =>
          0.45 + Math.abs(edge.correlation) * 0.45
      );


    /*
     * Korelačná hodnota na hrane.
     */
    const edgeLabels = labelsGroup
      .selectAll<SVGTextElement, GraphEdge>('text')
      .data(edges)
      .enter()
      .append('text')
      .attr('class', 'edge-label')
      .text(edge =>
        edge.correlation.toFixed(2)
      );


    /*
     * ------------------------------------------------------------------------
     * NODES
     * ------------------------------------------------------------------------
     */

    const nodeGroups = nodesGroup
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node-group');


    nodeGroups
      .append('circle')
      .attr('r', 30)
      .attr('class', 'graph-node');


    nodeGroups
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', 4)
      .text(node =>
        this.truncateLabel(
          node.id,
          18
        )
      );


    /*
     * ------------------------------------------------------------------------
     * FORCE SIMULATION
     * ------------------------------------------------------------------------
     */

    this.simulation = d3
      .forceSimulation<GraphNode>(nodes)

      .force(
        'link',

        d3
          .forceLink<GraphNode, GraphEdge>(edges)
          .id(node => node.id)
          .distance(150)
          .strength(0.5)
      )

      .force(
        'charge',

        d3
          .forceManyBody()
          .strength(-550)
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
          .forceCollide<GraphNode>()
          .radius(55)
      );


    /*
     * ------------------------------------------------------------------------
     * DRAG NODES
     * ------------------------------------------------------------------------
     */

    nodeGroups.call(

      d3
        .drag<SVGGElement, GraphNode>()

        .on(
          'start',
          (event, node) => {

            if (!event.active) {
              this.simulation
                ?.alphaTarget(0.3)
                .restart();
            }

            node.fx = node.x;
            node.fy = node.y;

          }
        )

        .on(
          'drag',
          (event, node) => {

            node.fx = event.x;
            node.fy = event.y;

          }
        )

        .on(
          'end',
          (event, node) => {

            if (!event.active) {
              this.simulation
                ?.alphaTarget(0);
            }

            /*
             * Po pustení sa node znovu môže pohybovať.
             */
            node.fx = null;
            node.fy = null;

          }
        )

    );


    /*
     * ------------------------------------------------------------------------
     * SIMULATION UPDATE
     * ------------------------------------------------------------------------
     */

    this.simulation.on(
      'tick',
      () => {

        links
          .attr(
            'x1',
            edge =>
              (edge.source as GraphNode).x ?? 0
          )
          .attr(
            'y1',
            edge =>
              (edge.source as GraphNode).y ?? 0
          )
          .attr(
            'x2',
            edge =>
              (edge.target as GraphNode).x ?? 0
          )
          .attr(
            'y2',
            edge =>
              (edge.target as GraphNode).y ?? 0
          );


        edgeLabels
          .attr(
            'x',
            edge => {

              const source =
                edge.source as GraphNode;

              const target =
                edge.target as GraphNode;

              return (
                ((source.x ?? 0) +
                  (target.x ?? 0)) /
                2
              );

            }
          )

          .attr(
            'y',
            edge => {

              const source =
                edge.source as GraphNode;

              const target =
                edge.target as GraphNode;

              return (
                ((source.y ?? 0) +
                  (target.y ?? 0)) /
                2
              );

            }
          );


        nodeGroups.attr(
          'transform',
          node =>
            `translate(${node.x ?? 0}, ${node.y ?? 0})`
        );

      }
    );

  }


  private truncateLabel(
    label: string,
    maxLength: number
  ): string {

    if (label.length <= maxLength) {
      return label;
    }

    return (
      label.substring(
        0,
        maxLength - 3
      ) + '...'
    );
  }

}