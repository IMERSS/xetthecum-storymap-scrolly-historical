"use strict";

/* global L */

// noinspection ES6ConvertVarToLetConst // otherwise this is a duplicate on minifying
var maxwell = fluid.registerNamespace("maxwell");
// noinspection ES6ConvertVarToLetConst // otherwise this is a duplicate on minifying
var hortis = fluid.registerNamespace("hortis");

// mixin grade which mediates event flow from viz to Leaflet pane
fluid.defaults("maxwell.scrollyVizBinder", {
    gradeNames: "maxwell.templateScrollyPaneHandler",
    listeners: {
        // Override the built-in old fashioned rendering
        "onResourcesLoaded.renderMarkup": "fluid.identity",
        "sunburstLoaded.listenHash": {
            funcName: "maxwell.scrollyViz.listenHash",
            args: "{that}",
            priority: "after:fluid-componentConstruction"
        }
    },
    // Override non-rendering selector from hortis.scrollyMapLoader
    selectors: { // The map does not render
        mapHolder: "{maxwell.scrollyLeafletMap}.container"
    },
    invokers: {
        polyOptions: "maxwell.scrollyViz.polyOptions({that}, {arguments}.0)",
        handlePoly: "maxwell.scrollyViz.handlePoly({that}, {arguments}.0, {arguments}.1)"
    },
    distributeOptions: {
        bareRegionExtra: {
            target: "{that hortis.leafletMap}.options.gradeNames",
            record: "maxwell.bareRegionsExtra"
        },
        map: {
            target: "{that hortis.leafletMap}.options.members.map",
            record: "{scrollyLeafletMap}.map"
        },
        checklistRanks: {
            target: "{that sunburst > checklist}.options.filterRanks",
            record: ["family", "phylum", "class", "order", "species"]
        }
    }
});

fluid.registerNamespace("maxwell.legendKey");

maxwell.legendKey.rowTemplate = "<div class=\"fld-imerss-legend-row %rowClass\">" +
    "<span class=\"fld-imerss-legend-icon\"></span>" +
    "<span class=\"fld-imerss-legend-preview %previewClass\" style=\"%previewStyle\"></span>" +
    "<span class=\"fld-imerss-legend-label\">%keyLabel</span>" +
    "</div>";


maxwell.legendKey.renderMarkup = function (markup, clazz, className) {
    const style = hortis.fillColorToStyle(clazz.fillColor || clazz.color);
    const normal = hortis.normaliseToClass(className);
    return fluid.stringTemplate(markup, {
        rowClass: "fld-imerss-legend-row-" + normal,
        previewClass: "fld-imerss-class-" + normal,
        previewStyle: "background-color: " + style.fillColor,
        keyLabel: className
    });
};

// cf. Xetthecum's hortis.legendKey.drawLegend
maxwell.legendKey.drawLegend = function (map) {
    const regionRows = fluid.transform(map.regions, function (troo, regionName) {
        return maxwell.legendKey.renderMarkup(maxwell.legendKey.rowTemplate, map.regions[regionName], regionName);
    });
    const markup = Object.values(regionRows).join("\n");
    const legend = L.control({position: "bottomright"});
    const container = document.createElement("div");
    container.classList.add("mxcw-legend");
    container.innerHTML = markup;
    legend.onAdd = function () {
        return container;
    };
    legend.addTo(map.map);
    map.clazzToLegendNodes = fluid.transform(map.regions, function (troo, regionName) {
        const rowSel = ".fld-imerss-legend-row-" + hortis.normaliseToClass(regionName);
        const row = container.querySelector(rowSel);
        row.addEventListener("click", function () {
            map.events.selectRegion.fire(regionName, regionName);
        });
    });
    return container;
};

maxwell.legendVisible = function (container, isVisible) {
    container.classList[isVisible ? "remove" : "add"]("mxcw-hidden");
};

// Addon grade for hortis.leafletMap - all this stuff needs to go upstairs into LeafletMapWithBareRegions
fluid.defaults("maxwell.bareRegionsExtra", {
    // These two from withRegions, pull up into withLegend
    selectors: {
        // key is from Xetthecum, selector is ours - we don't have "keys", normalise this
        legendKeys: ".mxcw-legend"
    },
    modelListeners: {
        legend: {
            path: "selectedRegions.*",
            func: "hortis.legendKey.selectRegion",
            args: ["{that}", "{change}.value", "{change}.path"]
        },
        legendVisible: {
            path: "{paneHandler}.model.isVisible",
            func: "maxwell.legendVisible",
            args: ["{that}.legendContainer", "{change}.value"]
        },
        regionToHash: {
            path: "mapBlockTooltipId",
            func: "maxwell.scrollyViz.updateRegionHash",
            args: ["{that}", "{change}"]
        }
    },
    members: {
        legendContainer: "@expand:maxwell.legendKey.drawLegend({that}, {paneHandler})"
    },
    listeners: {
        "buildMap.drawRegions": "maxwell.drawBareRegions({that}, {scrollyPage})",
        //                                                                          class,       community       source
        "selectRegion.regionSelection": "hortis.leafletMap.regionSelection({that}, {arguments}.0, {arguments}.1, {arguments}.2)"
    }
});

fluid.registerNamespace("maxwell.scrollyViz");

maxwell.regionClass = function (className) {
    return "fld-imerss-region-" + hortis.normaliseToClass(className);
};

// Identical to last part of hortis.leafletMap.withRegions.drawRegions
maxwell.drawBareRegions = function (map, scrollyPage) {
    map.applier.change("selectedRegions", hortis.leafletMap.selectedRegions(null, map.classes));

    const highlightStyle = Object.keys(map.regions).map(function (key) {
        return "." + maxwell.regionClass(key) + " {\n" +
            "  fill-opacity: var(" + hortis.regionOpacity(key) + ");\n" +
            "  stroke: var(" + hortis.regionBorder(key) + ");\n" +
            "}\n";
    });
    hortis.addStyle(highlightStyle.join("\n"));

    const container = scrollyPage.map.map.getContainer();
    $(container).on("click", function (event) {
        if (event.target === container) {
            map.events.clearMapSelection.fire();
        }
    });
    $(document).on("click", function (event) {
        const closest = event.target.closest(".fld-imerss-nodismiss-map");
        // Mysteriously SVG paths are not in the document
        if (!closest && event.target.closest("body")) {
            map.events.clearMapSelection.fire();
        }
    });

    const regions = container.querySelectorAll("path.fld-imerss-region");
    [...regions].forEach(region => region.setAttribute("stroke-width", 3));

};

// Hack override to agree with base opacity in rendered map
hortis.leafletMap.showSelectedRegions = function (map, selectedRegions) {
    const style = map.container[0].style;
    const noSelection = map.model.mapBlockTooltipId === null;
    Object.keys(map.regions).forEach(function (key) {
        const lineFeature = map.classes[key].color;
        const opacity = noSelection ? "0.6" : selectedRegions[key] ? "1.0" : "0.3";
        style.setProperty(hortis.regionOpacity(key), opacity);
        style.setProperty(hortis.regionBorder(key), selectedRegions[key] ? "#FEF410" : (lineFeature ? fluid.colour.arrayToString(lineFeature) : "none"));
    });
};


maxwell.scrollyViz.polyOptions = function (paneHandler, shapeOptions) {
    const region = shapeOptions.mx_regionId;
    const overlay = {};
    if (region) {
        overlay.className = (shapeOptions.className || "") + " fld-imerss-region " + maxwell.regionClass(region);
        overlay.weight = 3;
        overlay.opacity = "1.0";
    }
    return {...shapeOptions, ...overlay};
};

maxwell.scrollyViz.handlePoly = function (paneHandler, Lpolygon, shapeOptions) {
    const className = paneHandler.options.paneKey;
    const region = shapeOptions.mx_regionId;
    console.log("Got polygon ", Lpolygon, " for pane " + className + " and region " + region);
    // cf.hortis.leafletMap.withRegions.drawRegions
    if (region) {
        Lpolygon.on("click", function () {
            console.log("Map clicked on region ", region, " polygon ", Lpolygon);
            const map = paneHandler.map;
            map.events.selectRegion.fire(region, region);
        });
    }
};

maxwell.scrollyViz.listenHash = function (paneHandler) {
    const map = paneHandler.map;
    window.addEventListener("hashchange", function () {
        const hash = location.hash;
        if (hash.startsWith("#region:")) {
            const region = hash.substring("#region:".length);
            map.events.selectRegion.fire(region, region, "hash");
        } else {
            map.events.clearMapSelection.fire();
        }
    });
};

maxwell.scrollyViz.updateRegionHash = function (paneHandler, change) {
    if (!change.transaction.fullSources.hash) {
        window.history.pushState(null, null, change.value ? "#region:" + change.value : "#");
    }
};