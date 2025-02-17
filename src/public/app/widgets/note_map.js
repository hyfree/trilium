import libraryLoader from "../services/library_loader.js";
import server from "../services/server.js";
import attributeService from "../services/attributes.js";
import hoistedNoteService from "../services/hoisted_note.js";
import appContext from "../services/app_context.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import linkContextMenuService from "../services/link_context_menu.js";

const TPL = `<div class="note-map-widget" style="position: relative;">
    <style>
        .type-special .note-detail, .note-detail-note-map {
            height: 100%;
        }
        
        .map-type-switcher {
            position: absolute; 
            top: 10px; 
            right: 10px; 
            background-color: var(--accented-background-color);
            z-index: 1000;
        }
        
        .map-type-switcher .bx {
            font-size: x-large;
        }
    </style>
    
    <div class="btn-group btn-group-sm map-type-switcher" role="group">
      <button type="button" class="btn btn-secondary" title="Link Map" data-type="link"><span class="bx bx-network-chart"></span></button>
      <button type="button" class="btn btn-secondary" title="Tree map" data-type="tree"><span class="bx bx-sitemap"></span></button>
    </div>

    <div class="style-resolver"></div>

    <div class="note-map-container"></div>
</div>`;

export default class NoteMapWidget extends NoteContextAwareWidget {
    constructor(widgetMode) {
        super();

        this.widgetMode = widgetMode; // 'type' or 'ribbon'
    }

    doRender() {
        this.$widget = $(TPL);

        this.$container = this.$widget.find(".note-map-container");
        this.$styleResolver = this.$widget.find('.style-resolver');

        window.addEventListener('resize', () => this.setHeight(), false);

        this.$widget.find(".map-type-switcher button").on("click",  async e => {
            const type = $(e.target).closest("button").attr("data-type");

            await attributeService.setLabel(this.noteId, 'mapType', type);
        });

        super.doRender();
    }

    setHeight() {
        if (!this.graph) { // no graph has been even rendered
            return;
        }

        const $parent = this.$widget.parent();

        this.graph
            .height($parent.height())
            .width($parent.width());
    }

    async refreshWithNote() {
        this.$widget.show();

        this.css = {
            fontFamily: this.$container.css("font-family"),
            textColor: this.rgb2hex(this.$container.css("color")),
            mutedTextColor: this.rgb2hex(this.$styleResolver.css("color"))
        };

        this.mapType = this.note.getLabelValue("mapType") === "tree" ? "tree" : "link";

        this.setHeight();

        await libraryLoader.requireLibrary(libraryLoader.FORCE_GRAPH);

        this.graph = ForceGraph()(this.$container[0])
            .width(this.$container.width())
            .height(this.$container.height())
            .onZoom(zoom => this.setZoomLevel(zoom.k))
            .d3AlphaDecay(0.01)
            .d3VelocityDecay(0.08)
            .nodeCanvasObject((node, ctx) => this.paintNode(node, this.stringToColor(node.type), ctx))
            .nodePointerAreaPaint((node, ctx) => this.paintNode(node, this.stringToColor(node.type), ctx))
            .nodePointerAreaPaint((node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, this.noteIdToSizeMap[node.id], 0, 2 * Math.PI, false);
                ctx.fill();
            })
            .nodeLabel(node => node.name)
            .maxZoom(7)
            .warmupTicks(10)
            .linkDirectionalArrowLength(5)
            .linkDirectionalArrowRelPos(1)
            .linkWidth(1)
            .linkColor(() => this.css.mutedTextColor)
            .onNodeClick(node => appContext.tabManager.getActiveContext().setNote(node.id))
            .onNodeRightClick((node, e) => linkContextMenuService.openContextMenu(node.id, e));

        if (this.mapType === 'link') {
            this.graph
                .linkLabel(l => `${l.source.name} - <strong>${l.name}</strong> - ${l.target.name}`)
                .linkCanvasObject((link, ctx) => this.paintLink(link, ctx))
                .linkCanvasObjectMode(() => "after");
        }

        this.graph.d3Force('link').distance(40);
        this.graph.d3Force('center').strength(0.01);
        this.graph.d3Force('charge').strength(-30);
        this.graph.d3Force('charge').distanceMax(1000);

        let mapRootNoteId = this.getMapRootNoteId();

        const data = await this.loadNotesAndRelations(mapRootNoteId);

        this.renderData(data);
    }

    getMapRootNoteId() {
        if (this.widgetMode === 'ribbon') {
            return this.noteId;
        }

        let mapRootNoteId = this.note.getLabelValue("mapRootNoteId");

        if (mapRootNoteId === 'hoisted') {
            mapRootNoteId = hoistedNoteService.getHoistedNoteId();
        } else if (!mapRootNoteId) {
            mapRootNoteId = appContext.tabManager.getActiveContext().parentNoteId;
        }

        return mapRootNoteId;
    }

    stringToColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        let colour = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            colour += ('00' + value.toString(16)).substr(-2);
        }
        return colour;
    }

    rgb2hex(rgb) {
        return `#${rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
            .slice(1)
            .map(n => parseInt(n, 10).toString(16).padStart(2, '0'))
            .join('')}`
    }

    setZoomLevel(level) {
        this.zoomLevel = level;
    }

    paintNode(node, color, ctx) {
        const {x, y} = node;
        const size = this.noteIdToSizeMap[node.id];

        ctx.fillStyle = (this.widgetMode === 'ribbon' && node.id === this.noteId) ? 'red' : color;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI, false);
        ctx.fill();

        const toRender = this.zoomLevel > 2
            || (this.zoomLevel > 1 && size > 6)
            || (this.zoomLevel > 0.3 && size > 10);

        if (!toRender) {
            return;
        }

        ctx.fillStyle = this.css.textColor;
        ctx.font = size + 'px ' + this.css.fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let title = node.name;

        if (title.length > 15) {
            title = title.substr(0, 15) + "...";
        }

        ctx.fillText(title, x, y + Math.round(size * 1.5));
    }

    paintLink(link, ctx) {
        if (this.zoomLevel < 5) {
            return;
        }

        ctx.font = '3px ' + this.css.fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.css.mutedTextColor;

        const {source, target} = link;

        const x = (source.x + target.x) / 2;
        const y = (source.y + target.y) / 2;

        ctx.save();
        ctx.translate(x, y);

        const deltaY = source.y - target.y;
        const deltaX = source.x - target.x;

        let angle = Math.atan2(deltaY, deltaX);
        let moveY = 2;

        if (angle < -Math.PI / 2 || angle > Math.PI / 2) {
            angle += Math.PI;
            moveY = -2;
        }

        ctx.rotate(angle);
        ctx.fillText(link.name, 0, moveY);
        ctx.restore();
    }

    async loadNotesAndRelations(mapRootNoteId) {
        const resp = await server.post(`note-map/${mapRootNoteId}/${this.mapType}`);

        this.calculateNodeSizes(resp);

        const links = this.getGroupedLinks(resp.links);

        this.nodes = resp.notes.map(([noteId, title, type]) => ({
            id: noteId,
            name: title,
            type: type,
        }));

        return {
            nodes: this.nodes,
            links: links.map(link => ({
                id: link.id,
                source: link.sourceNoteId,
                target: link.targetNoteId,
                name: link.names.join(", ")
            }))
        };
    }

    getGroupedLinks(links) {
        const linksGroupedBySourceTarget = {};

        for (const link of links) {
            const key = `${link.sourceNoteId}-${link.targetNoteId}`;

            if (key in linksGroupedBySourceTarget) {
                if (!linksGroupedBySourceTarget[key].names.includes(link.name)) {
                    linksGroupedBySourceTarget[key].names.push(link.name);
                }
            } else {
                linksGroupedBySourceTarget[key] = {
                    id: key,
                    sourceNoteId: link.sourceNoteId,
                    targetNoteId: link.targetNoteId,
                    names: [link.name]
                }
            }
        }

        return Object.values(linksGroupedBySourceTarget);
    }

    calculateNodeSizes(resp) {
        this.noteIdToSizeMap = {};

        if (this.mapType === 'tree') {
            const {noteIdToDescendantCountMap} = resp;

            for (const noteId in noteIdToDescendantCountMap) {
                this.noteIdToSizeMap[noteId] = 4;

                const count = noteIdToDescendantCountMap[noteId];

                if (count > 0) {
                    this.noteIdToSizeMap[noteId] += 1 + Math.round(Math.log(count) / Math.log(1.5));
                }
            }
        }
        else if (this.mapType === 'link') {
            const noteIdToLinkCount = {};

            for (const link of resp.links) {
                noteIdToLinkCount[link.targetNoteId] = 1 + (noteIdToLinkCount[link.targetNoteId] || 0);
            }

            for (const [noteId] of resp.notes) {
                this.noteIdToSizeMap[noteId] = 4;

                if (noteId in noteIdToLinkCount) {
                    this.noteIdToSizeMap[noteId] += Math.min(Math.pow(noteIdToLinkCount[noteId], 0.5), 15);
                }
            }
        }
    }

    renderData(data) {
        this.graph.graphData(data);

        if (this.widgetMode === 'ribbon') {
            setTimeout(() => {
                const node = this.nodes.find(node => node.id === this.noteId);

                this.graph.centerAt(node.x, node.y, 500);
            }, 1000);
        }
        else if (this.widgetMode === 'type') {
            if (data.nodes.length > 1) {
                setTimeout(() => this.graph.zoomToFit(400, 10), 1000);
            }
        }
    }

    cleanup() {
        this.$container.html('');
    }

    entitiesReloadedEvent({loadResults}) {
        if (loadResults.getAttributes(this.componentId).find(attr => attr.name === 'mapType' && attributeService.isAffecting(attr, this.note))) {
            this.refresh();
        }
    }
}
