import { emptyOversizedContainer, emptyOversizedContainerIndex, zeroFill } from './BufferArrayManager.js';
import * as CostWorker from './Worker/simplify.worker.js';
import { getIndexedPositions } from './Utils.js';
import { Vector2, Vector3, BufferAttribute, BufferGeometry } from './threeImport.js';
export class WebWorker {
  constructor(worker) {
    const blob = new Blob(['(' + worker.toString() + ')()'], {
      type: 'text/javascript'
    });
    return new Worker(URL.createObjectURL(blob));
  }
}

/*
 *  @author Pawel Misiurski https://stackoverflow.com/users/696535/pawel
 *  @author zz85 / http://twitter.com/blurspline / http://www.lab4games.net/zz85/blog
 *  Simplification Geometry Modifier
 *    - based on code and technique
 *    - by Stan Melax in 1998
 *    - Progressive Mesh type Polygon Reduction Algorithm
 *    - http://www.melax.com/polychop/
 */
const FIELDS_NO = 30;
const FIELDS_OVERSIZE = 500;
// if this value is below 10k workers start overlapping each other's work(neighbours can be outside worker's range, there's a locking mechanism for this but not perfect)
const MIN_VERTICES_PER_WORKER = 20000;
// the bigger MIN_VERTICES_PER_WORKER is the bigger OVERSIZE_CONTAINER_CAPACITY should be, 10% size?
const OVERSIZE_CONTAINER_CAPACITY = 2000;
let reqId = 0;

// TODO: wtf is happening with multithreaded optimiser
let totalAvailableWorkers = 1; // Math.min(5, navigator.hardwareConcurrency);
// if SAB is not available use only 1 worker per object to fully contain dataArrays that will be only available after using transferable objects
const isSAB = typeof SharedArrayBuffer !== 'undefined'
const MAX_WORKERS_PER_OBJECT = !isSAB ? 1 : navigator.hardwareConcurrency;
const DISCARD_BELOW_VERTEX_COUNT = 400;

const preloadedWorkers = [];

export function createWorkers() {
  for (let i = 0; i < totalAvailableWorkers; i++) {
    preloadedWorkers.push(new WebWorker(CostWorker.default));
    preloadedWorkers.forEach((w, index) => {
      w.free = true;
      w.id = index;
    });
  }
}

export function killWorkers() {
  preloadedWorkers.forEach(w => w.terminate());
  preloadedWorkers.length = 0;
}

function discardSimpleGeometry(geometry) {
  if (geometry.isGeometry) {
    if (geometry.vertices.length < DISCARD_BELOW_VERTEX_COUNT) {
      return true;
    }
  } else if (geometry.isBufferGeometry) {
    if (geometry.attributes.position.count < DISCARD_BELOW_VERTEX_COUNT) {
      return geometry;
    }
  } else {
    throw new Error('Not supported geometry type');
  }
  return false;
}

export function meshSimplifier(
  geometry,
  percentage,
  maximumCost = 5,
  modelSize,
  preserveTexture = true,
  attempt = 0,
  resolveTop
) {
  if (!modelSize) {
    var box = geometry.boundingBox;
    if (!box) {
      geometry.computeBoundingBox();
      box = geometry.boundingBox;
    }
    modelSize = Math.max(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    );
  };
  return new Promise((resolve, reject) => {
    if (discardSimpleGeometry(geometry)) {
      return resolve(geometry);
    }
    // if (geometry.index) {
    //   geometry = geometry.toNonIndexed();
    // }

    preserveTexture =
      preserveTexture && geometry.attributes.uv && geometry.attributes.uv.count;

    console.time('Mesh simplification');
    if (geometry.attributes.position.count < 50) {
      console.warn('Less than 50 vertices, returning');
      resolveTop(geometry);
    }

    new Promise((resolve2, reject2) => {
      requestFreeWorkers(
        preloadedWorkers,
        geometry.attributes.position.count,
        resolve2
      );
    }).then(workers => {
      sendWorkToWorkers(
        workers,
        geometry,
        percentage,
        maximumCost,
        modelSize,
        preserveTexture,
        geometry
      )
        .then(dataArrayViews => {
          const newGeo = createNewBufferGeometry(
            dataArrayViews.verticesView,
            dataArrayViews.facesView,
            dataArrayViews.faceNormalsView,
            dataArrayViews.facesUVsView,
            dataArrayViews.skinWeight,
            dataArrayViews.skinIndex,
            dataArrayViews.faceMaterialIndexView,
            preserveTexture,
            geometry
          );

          // for (let key in dataArrayViews) {
          //   delete dataArrayViews[key];
          // }
          return (resolveTop || resolve)(newGeo);
        })
        .catch(e => {
          return reject(geometry);
          // if (attempt >= 3) {
          //   console.log('Simplifying error messages', e);
          //   console.error(
          //     'Error in simplifying. Returning original.',
          //     geometry.name
          //   );
          //   return (resolveTop || resolve)(geometry);
          // }
          // console.log('Simplifying error messages', e);
          // console.error(
          //   'Error in simplifying. Retrying in 500ms, attempt',
          //   attempt,
          //   geometry.name
          // );
          // const attemptCount = attempt + 1;
          // setTimeout(() => {
          //   meshSimplifier(
          //     geometry,
          //     percentage,
          //     maximumCost,
          //     modelSize,
          //     (preserveTexture = true),
          //     attemptCount,
          //     resolveTop || resolve
          //   );
          // }, 500);
        });
    });
  });
}

let reusingDataArrays = null;
let previousVertexCount = 0;
function createDataArrays(verexCount, faceCount, workersAmount) {
  if (
    workersAmount === totalAvailableWorkers &&
    reusingDataArrays !== null &&
    verexCount <= previousVertexCount
  ) {
    emptyOversizedContainerIndex(reusingDataArrays.facesView);
    emptyOversizedContainer(reusingDataArrays.specialCases);
    emptyOversizedContainerIndex(reusingDataArrays.specialCasesIndex);
    emptyOversizedContainer(reusingDataArrays.specialFaceCases);
    emptyOversizedContainerIndex(reusingDataArrays.specialFaceCasesIndex);

    // zeroFill(reusingDataArrays.neighbourCollapse);
    // zeroFill(reusingDataArrays.verticesView);
    // zeroFill(reusingDataArrays.faceNormalView);
    // zeroFill(reusingDataArrays.faceNormalsView);
    // zeroFill(reusingDataArrays.facesUVsView);
    // zeroFill(reusingDataArrays.costStore);
    // zeroFill(reusingDataArrays.costCountView);
    // zeroFill(reusingDataArrays.costTotalView);
    // zeroFill(reusingDataArrays.costMinView);
    // zeroFill(reusingDataArrays.neighbourCollapse);
    // zeroFill(reusingDataArrays.faceMaterialIndexView);
    reusingDataArrays.vertexWorkStatus.fill(0);
    reusingDataArrays.buildIndexStatus.fill(0);
    reusingDataArrays.vertexNeighboursView.fill(0);
    reusingDataArrays.vertexFacesView.fill(0);
    reusingDataArrays.boneCosts.fill(0);
    return reusingDataArrays;
  }

  previousVertexCount = verexCount;
  const SAB = isSAB ? SharedArrayBuffer : ArrayBuffer
  // const positions = geo.attributes.position.array;
  const verticesAB = new SAB(verexCount * 3 * 4);
  const facesAB = new SAB(faceCount * 3 * 4); // REMOVED additional * 3 because something is fucked and i don't want to mess up other 'depending on faceCount'
  const faceNormalsAB = new SAB(faceCount * 9 * 4); // 3 or 9 depending on faceCount
  const faceUVsAB = new SAB(faceCount * 6 * 4); // 2 or 6 depending on faceCount
  const costStoreAB = new SAB(verexCount * 4);
  const neighbourCollapseAB = new SAB(verexCount * 4);
  const faceMaterialIndexAB = new SAB(faceCount * 3 * 2);
  const vertexNeighboursAB = new SAB(verexCount * FIELDS_NO * 4);
  const vertexFacesAB = new SAB(verexCount * FIELDS_NO * 4);

  const verticesView = new Float32Array(verticesAB);
  const facesView = new Int32Array(facesAB);
  emptyOversizedContainerIndex(facesView);

  const faceNormalView = new Float32Array(new SAB(faceCount * 3 * 4)); // // 1 or 3 depends on faceCount
  const faceNormalsView = new Float32Array(faceNormalsAB);
  const facesUVsView = new Float32Array(faceUVsAB);
  const skinWeight = new Float32Array(new SAB(faceCount * 12 * 4));
  const skinIndex = new Uint32Array(new SAB(faceCount * 12 * 4));
  const costStore = new Float32Array(costStoreAB);
  const costCountView = new Int16Array(new SAB(verexCount * 2));
  const costTotalView = new Float32Array(new SAB(verexCount * 4));
  const costMinView = new Float32Array(new SAB(verexCount * 4));
  const neighbourCollapse = new Int32Array(neighbourCollapseAB);
  const vertexWorkStatus = new Uint8Array(new SAB(verexCount));
  const buildIndexStatus = new Uint8Array(new SAB(workersAmount));
  const faceMaterialIndexView = new Uint8Array(faceMaterialIndexAB);
  const boneCosts = new Uint8Array(new SAB(200));

  // 10 elements, up to 9 neighbours per vertex + first number tells how many neighbours
  const vertexNeighboursView = new Uint32Array(vertexNeighboursAB);
  const vertexFacesView = new Uint32Array(vertexFacesAB);

  const specialCases = new Int32Array(
    new SAB(FIELDS_OVERSIZE * OVERSIZE_CONTAINER_CAPACITY * 4)
  );
  emptyOversizedContainer(specialCases);
  const specialCasesIndex = new Int32Array(new SAB(verexCount * 4));
  emptyOversizedContainerIndex(specialCasesIndex);
  const specialFaceCases = new Int32Array(
    new SAB(FIELDS_OVERSIZE * OVERSIZE_CONTAINER_CAPACITY * 4)
  );
  emptyOversizedContainer(specialFaceCases);
  const specialFaceCasesIndex = new Int32Array(new SAB(faceCount * 4));
  emptyOversizedContainerIndex(specialFaceCasesIndex);

  reusingDataArrays = {
    verticesView,
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    skinWeight,
    skinIndex,
    faceMaterialIndexView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases: specialCases,
    specialCasesIndex: specialCasesIndex,
    specialFaceCases: specialFaceCases,
    specialFaceCasesIndex: specialFaceCasesIndex,
    costStore,
    boneCosts,
    costCountView,
    costTotalView,
    costMinView,
    neighbourCollapse,
    vertexWorkStatus,
    buildIndexStatus
  };
  return reusingDataArrays;
}

function loadGeometryToDataArrays(geometry, workersAmount) {
  let dataArrays;
  if (geometry.isGeometry) {
    geometry.mergeVertices();

    // geometry.mergeVertices();
    dataArrays = createDataArrays(
      geometry.vertices.length,
      geometry.faces.length,
      workersAmount
    );
    loadGeometry(dataArrays, geometry);
  } else if (geometry.isBufferGeometry) {
    const positionsCount = geometry.attributes.position.count;
    const faceCount = geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;

    dataArrays = createDataArrays(positionsCount, faceCount, workersAmount);
    loadBufferGeometry(dataArrays, geometry, workersAmount);
  } else {
    throw new Error('Not supported geometry type');
  }
  dataArrays.collapseQueue = new Uint32Array(150);
  return dataArrays;
}

function loadBufferGeometry(dataArrays, geometry) {
  const { index, positions, newVertexIndexByOld } = getIndexedPositions(
    geometry,
    4
  );
  const {
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    skinWeight,
    skinIndex,
    faceMaterialIndexView,
    boneCosts,
  } = dataArrays;

  if (geometry.skeleton) {
    if (!geometry.boneCosts) {
      console.error('Optimesh: Bone costs are missing!')

    } else {
      Object.keys(geometry.boneCosts).forEach(boneName => {
        const idx = geometry.skeleton.bones.findIndex(bone => bone.name === boneName)
        if (!idx) return
        boneCosts[idx] = geometry.boneCosts[boneName]
      })
    }
  }
  // console.log('new indexed addresses', newVertexIndexByOld);

  // const vCount = positions.length / 3;

  // TEMP: solution until faceView has correct smaller numer of faces
  emptyOversizedContainerIndex(facesView);
  facesView.set(index);
  dataArrays.verticesView = positions; // .set(positions);

  for (var i = 0; i < facesView.length / 3; i++) {
    const faceNormal = computeFaceNormal(i, facesView, dataArrays.verticesView);
    faceNormalView[i * 3] = faceNormal.x;
    faceNormalView[i * 3 + 1] = faceNormal.y;
    faceNormalView[i * 3 + 2] = faceNormal.z;
  }

  // position and index are indexed, but other attributes are not
  if (geometry.index) {
    geometry = geometry.toNonIndexed()
  }

  if (geometry.attributes.normal) {
    faceNormalsView.set(geometry.attributes.normal.array);
  }

  if (geometry.attributes.uv) {
    facesUVsView.set(geometry.attributes.uv.array);
  }
  if (geometry.attributes.skinWeight) {
    skinWeight.set(geometry.attributes.skinWeight.array);
  }

  if (geometry.attributes.skinIndex) {
    skinIndex.set(geometry.attributes.skinIndex.array);
  }

  geometry.groups.forEach(group => {
    for (var i = group.start, il = group.start + group.count; i < il; i++) {
      faceMaterialIndexView[i / 3] = group.materialIndex;
    }
  });
}

// borrowed from geometry
var cb = new Vector3(),
  ab = new Vector3();
var v1Temp = new Vector3(),
  v2Temp = new Vector3();
var v2Tmp = new Vector2();
function computeFaceNormal(faceId, facesView, verticesView) {
  getVertexOnFaceId(faceId, facesView, verticesView, 1, v1Temp);
  getVertexOnFaceId(faceId, facesView, verticesView, 2, v2Temp);

  cb.subVectors(v2Temp, v1Temp);

  getVertexOnFaceId(faceId, facesView, verticesView, 0, v2Temp);
  ab.subVectors(v2Temp, v1Temp);
  cb.cross(ab);
  cb.normalize();

  // do not pass around, this will mutate
  return cb;
}

function getVertexOnFaceId(faceId, facesView, verticesView, index, target) {
  const vertexId = facesView[faceId * 3 + index];
  target.set(
    verticesView[vertexId * 3],
    verticesView[vertexId * 3 + 1],
    verticesView[vertexId * 3 + 2]
  );
}

function loadGeometry(dataArrays, geometry) {
  const {
    verticesView,
    facesView,
    faceNormalView,
    faceNormalsView,
    facesUVsView,
    faceMaterialIndexView
  } = dataArrays;
  for (let i = 0; i < geometry.vertices.length; i++) {
    verticesView[i * 3] = geometry.vertices[i].x;
    verticesView[i * 3 + 1] = geometry.vertices[i].y;
    verticesView[i * 3 + 2] = geometry.vertices[i].z;
  }

  const faces = geometry.faces;
  var faceUVs = geometry.faceVertexUvs[0];

  const doFaceUvs = !!faceUVs.length;
  for (let i = 0; i < faces.length; i++) {
    facesView[i * 3] = faces[i].a;
    facesView[i * 3 + 1] = faces[i].b;
    facesView[i * 3 + 2] = faces[i].c;

    faceNormalView[i * 3] = faces[i].normal.x;
    faceNormalView[i * 3 + 1] = faces[i].normal.y;
    faceNormalView[i * 3 + 2] = faces[i].normal.z;

    faceNormalsView[i * 9] = faces[i].vertexNormals[0].x;
    faceNormalsView[i * 9 + 1] = faces[i].vertexNormals[0].y;
    faceNormalsView[i * 9 + 2] = faces[i].vertexNormals[0].z;

    faceNormalsView[i * 9 + 3] = faces[i].vertexNormals[1].x;
    faceNormalsView[i * 9 + 4] = faces[i].vertexNormals[1].y;
    faceNormalsView[i * 9 + 5] = faces[i].vertexNormals[1].z;

    faceNormalsView[i * 9 + 6] = faces[i].vertexNormals[2].x;
    faceNormalsView[i * 9 + 7] = faces[i].vertexNormals[2].y;
    faceNormalsView[i * 9 + 8] = faces[i].vertexNormals[2].z;

    if (doFaceUvs) {
      facesUVsView[i * 6] = faceUVs[i][0].x;
      facesUVsView[i * 6 + 1] = faceUVs[i][0].y;
      facesUVsView[i * 6 + 2] = faceUVs[i][1].x;
      facesUVsView[i * 6 + 3] = faceUVs[i][1].y;
      facesUVsView[i * 6 + 4] = faceUVs[i][2].x;
      facesUVsView[i * 6 + 5] = faceUVs[i][2].y;
    }

    faceMaterialIndexView[i] = faces[i].materialIndex;
  }
}

function requestFreeWorkers(workers, verticesLength, onWorkersReady) {
  // at least 2000 vertices per worker, limit amount of workers
  const availableWorkersAmount = workers.length;
  let maxWorkers = Math.max(
    1,
    Math.round(verticesLength / MIN_VERTICES_PER_WORKER)
  );

  if (!workers.length) {
    console.error('Workers not created. Call createWorkers at the beginning');
  }

  // limit to workers with free flag
  let workersAmount = Math.min(
    Math.min(workers.filter(w => w.free).length, maxWorkers),
    availableWorkersAmount
  );

  // limit to MAX_WORKERS_PER_OBJECT
  workersAmount = Math.min(MAX_WORKERS_PER_OBJECT, workersAmount);

  console.log(
    'requesting workers',
    workersAmount,
    workers.length,
    workers.filter(w => w.free).length
  );

  // wait for at least 2
  if (workersAmount < 1) {
    setTimeout(() => {
      requestFreeWorkers(workers, verticesLength, onWorkersReady);
    }, 200);
    return;
  }
  const reservedWorkers = workers.filter(w => w.free).slice(0, workersAmount);
  reservedWorkers.forEach(w => {
    w.workStartTime = Date.now();
    w.free = false;
  });
  onWorkersReady(reservedWorkers);
}

function sendWorkToWorkers(
  workers,
  bGeometry,
  percentage,
  maximumCost,
  modelSize,
  preserveTexture,
  geometry
) {
  return new Promise((resolve, reject) => {
    const dataArrays = loadGeometryToDataArrays(geometry, workers.length);

    // this should not be done before instantiating workers
    // but it's needed because specialCases and specialFaceCases are using copying instead of SABs
    // buildVertexNeighboursIndex(
    //   dataArrays.facesView,
    //   dataArrays.vertexNeighboursView,
    //   dataArrays.vertexFacesView,
    //   dataArrays.specialCases,
    //   dataArrays.specialCasesIndex,
    //   dataArrays.specialFaceCases,
    //   dataArrays.specialFaceCasesIndex,
    //   0,
    //   dataArrays.facesView.length / 3
    // );
    // console.log(
    //   'Using',
    //   maxWorkers,
    //   'out of',
    //   workersAmount,
    //   'available workers(at least',
    //   MIN_VERTICES_PER_WORKER,
    //   'vertices per worker)'
    //   'vertices per worker)'
    // );

    reqId++;

    workers.forEach((w, i) => {
      if (w.free) {
        throw new Error('the worker should be reserved now');
      }
      let ifNoSABUseTransferable = undefined;
      if (!isSAB) {
        ifNoSABUseTransferable = Object.keys(dataArrays).reduce((acc, el) => {
          acc.push(dataArrays[el].buffer);
          return acc;
        }, []);
      }

      w.postMessage({
        task: 'load',
        id: w.id,
        workerIndex: i,
        modelSize: modelSize,
        totalWorkers: workers.length,
        verticesView: dataArrays.verticesView,
        facesView: dataArrays.facesView,
        faceNormalView: dataArrays.faceNormalView,
        faceNormalsView: dataArrays.faceNormalsView,
        facesUVsView: dataArrays.facesUVsView,
        skinWeight: dataArrays.skinWeight,
        skinIndex: dataArrays.skinIndex,
        costStore: dataArrays.costStore,
        boneCosts: dataArrays.boneCosts,
        faceMaterialIndexView: dataArrays.faceMaterialIndexView,
        vertexFacesView: dataArrays.vertexFacesView,
        vertexNeighboursView: dataArrays.vertexNeighboursView,
        costCountView: dataArrays.costCountView,
        costTotalView: dataArrays.costTotalView,
        costMinView: dataArrays.costMinView,
        neighbourCollapse: dataArrays.neighbourCollapse,
        vertexWorkStatus: dataArrays.vertexWorkStatus,
        buildIndexStatus: dataArrays.buildIndexStatus,
        specialCases: dataArrays.specialCases,
        specialCasesIndex: dataArrays.specialCasesIndex,
        specialFaceCases: dataArrays.specialFaceCases,
        specialFaceCasesIndex: dataArrays.specialFaceCasesIndex,

        // no shared buffers below but structural copying
        percentage,
        maximumCost,
        preserveTexture,
        FIELDS_NO,
        FIELDS_OVERSIZE,
        OVERSIZE_CONTAINER_CAPACITY,
        reqId
      }, ifNoSABUseTransferable);
      w.onDone = doneLoading.bind(null, reqId);
      w.addEventListener('message', w.onDone);
    });

    let doneCount = 0;
    let aborting = false;
    let errorMessages = [];
    function doneLoading(jobId, event) {
      if (event.data.reqId !== jobId) {
        // throw new Error('wrong job id');
        console.log('wrong job id');
        return;
      }
      const w = event.currentTarget;
      w.removeEventListener('message', w.onDone);
      w.free = true;

      doneCount++;

      if (!isSAB) {
        if (event.data.dataArrays) {
          Object.keys(reusingDataArrays).forEach(el => {
            reusingDataArrays[el] = event.data.dataArrays[el];
          });
        } else {
          reusingDataArrays = null
        }
      }

      if (event.data.task === 'simplificationError') {
        errorMessages.push(event.data.message);
        aborting = true;
      } else if (
        event.data.task === 'edgesCostsDone' &&
        doneCount >= workers.length
      ) {
        if (!isSAB) {
          resolve(event.data.dataArrays);
        } else {
          resolve(dataArrays);
        }
      }

      if (doneCount >= workers.length && aborting) {
        reject(errorMessages);
      }
    }
  });
}

function reindex(index) {
  const uniqueVertices = [];
  let mapNewToOld = new Uint32Array(index.length); // this is broken?
  const mapOldToNew = []; 
  let newIndexCount = 0;
  // find unique indices
  for (let i = 0; i < index.length / 3; i++) {
    const offset = i * 3;
    if (index[offset] === -1) continue;
    for (let j = 0; j < 3; j++) {
      if (!uniqueVertices.includes(index[offset + j])) {
        mapNewToOld[uniqueVertices.length] = index[offset + j];
        uniqueVertices.push(index[offset + j]);
      }
    }
    newIndexCount++;
  }

  mapNewToOld = mapNewToOld.slice(0, uniqueVertices.length) // is length inclusive?

  mapNewToOld.sort(); // must be typed array for sort!
  for (let i = 0; i < mapNewToOld.length; i++) {
    mapOldToNew[mapNewToOld[i]] = i;
  }

  const newIndex = new Uint32Array(newIndexCount * 3);
  newIndexCount = 0;
  for (let i = 0; i < index.length / 3; i++) {
    const offset = i * 3;
    if (index[offset] === -1) continue;
    const newOffset = newIndexCount * 3;

    newIndex[newOffset] = mapOldToNew[index[offset]];
    newIndex[newOffset + 1] = mapOldToNew[index[offset + 1]];
    newIndex[newOffset + 2] = mapOldToNew[index[offset + 2]];
    newIndexCount++;
  }

  return [newIndex, mapNewToOld];
}

function reindexAttribute(attribute, mapNewToOld, itemSize) {
  const newAttribute = new Float32Array(mapNewToOld.length * itemSize);
  for (let i = 0; i < mapNewToOld.length; i++) {
    const offset = i * itemSize;

    const address = mapNewToOld[i] * itemSize;

    for (let j = 0; j < itemSize; j++) {
      newAttribute[offset + j] = attribute[address + j];
    }
  }
  return newAttribute;
}

function createNewBufferGeometry(
  vertices,
  faces,
  normalsView,
  uvsView,
  skinWeight,
  skinIndex,
  faceMaterialIndexView,
  preserveTexture,
  geometry
) {
  const geo = new BufferGeometry();
  geo.name = geometry.name;
  let faceCount = 0;

  for (var i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;
    faceCount++;
  }

  // reindex atlasGroups
  if (geometry.userData.atlasGroups) {
    const atlasGroups = JSON.parse(JSON.stringify(geometry.userData.atlasGroups))
    let totalSkipped = 0
    atlasGroups.forEach(group => {
      let skippedInGroup = 0
      for (let i = group.start, l = group.start + group.count; i < l; i += 3) {
        if (faces[i] === -1) {
          skippedInGroup += 3
        }
      }
      group.start = group.start - totalSkipped
      group.count = group.count - skippedInGroup
      totalSkipped += skippedInGroup
    })
    geo.userData.atlasGroups = atlasGroups
  }

  // console.log('Faces reduction from : ', faces.length / 3, 'to', faceCount);
  var positions = new Float32Array(faceCount * 9); // faces * 3 vertices * vector3
  var normals = new Float32Array(faceCount * 9);
  var skinWeightArr = new Float32Array(faceCount * 12);
  var skinIndexArr = new Float32Array(faceCount * 12);
  var uvs = new Float32Array(faceCount * 6);

  let count = 0;

  if (geometry.index) {
    const [newindex, mapOldToNewIndex] = reindex(faces);
    geo.setIndex(new BufferAttribute(newindex, 1));

    const attributes = [
      {
        name: 'position',
        array: vertices,
        itemSize: 3
      },
      {
        name: 'normal',
        array: normalsView,
        itemSize: 3
      },
      {
        name: 'uv',
        array: uvsView,
        itemSize: 2
      },
      {
        name: 'skinWeight',
        array: skinWeight,
        itemSize: 4
      },
      {
        name: 'skinIndex',
        array: skinIndex,
        itemSize: 4
      }
    ];

    Object.keys(geometry.attributes).forEach(oldAttribute => {
      const attrib = attributes.find(el => el.name === oldAttribute);
      if(!attrib) {
        console.warn('Attribute copy not supported(ignore instanced, they will be copied later) in ', geometry.name, ': ', oldAttribute);
        return;
      }

      const reindexedAttribute = reindexAttribute(attrib.array, mapOldToNewIndex, attrib.itemSize);
      const setAttribute = geo.setAttribute ? geo.setAttribute : geo.addAttribute;
      setAttribute.call(geo, attrib.name, new BufferAttribute(reindexedAttribute, attrib.itemSize)); // TODO: when changing 3 to attrib.itemSize it all breaks
      // const bufferAttribute = new Float32Array(faceCount * 3 * attrib.itemSize);
      // count = 0;
      // for (i = 0; i < faces.length / 3; i++) {
      //   if (faces[i * 3] === -1) continue;

      //   for (var vId = 0; vId < 3; vId++) {
      //     const indexAddress = i * 3 + vId;

      //     copyItemFromBufferAttributeWithIndexVertex(
      //       faces,
      //       attrib.array,
      //       bufferAttribute,
      //       attrib.itemSize,
      //       i,
      //       count,
      //       vId,
      //       mapOldToNewIndex
      //     );
      //   }
      //   count++;
      // }

      // const bufferAttributeShrunk = new Float32Array(
      //   count * 3 * attrib.itemSize
      // );
      // bufferAttributeShrunk.set(bufferAttribute);
      // setAttribute.call(geo, 
      //   attrib.name,
      //   new BufferAttribute(bufferAttributeShrunk, attrib.itemSize)
      // );
    });
  }

  let currentMaterial = null;
  count = 0;

  const index = new Uint32Array(faceCount * 3);

  let currentGroup = null;

  for (i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;

    if (!geometry.index) {
      index[count * 3] = faces[i * 3];
      index[count * 3 + 1] = faces[i * 3 + 1];
      index[count * 3 + 2] = faces[i * 3 + 2];
      copyItemFromBufferAttributeWithIndex(faces, faces, index, 1, i, count);

      copyItemFromBufferAttributeWithIndex(
        faces,
        vertices,
        positions,
        3,
        i,
        count
      );

      copyItemFromBufferAttribute(normalsView, normals, 3, i, count);
      copyItemFromBufferAttribute(skinWeight, skinWeightArr, 4, i, count);
      copyItemFromBufferAttribute(skinIndex, skinIndexArr, 4, i, count);
      copyItemFromBufferAttribute(uvsView, uvs, 2, i, count);
    }

    if (faceMaterialIndexView[i] === currentMaterial) {
      currentGroup.count += 3;
    } else {
      currentMaterial = faceMaterialIndexView[i];
      currentGroup = {
        start: count * 3,
        count: 3,
        materialIndex: currentMaterial
      };
      geo.groups.push(currentGroup);
    }

    count++;
  }

  const vertexLength = geometry.index
    ? geo.attributes.position.array.length / 3
    : count * 3;

  const setAttribute = geo.setAttribute ? geo.setAttribute : geo.addAttribute;

  if (!geometry.index) {
    setAttribute.call(geo, 'position', new BufferAttribute(positions, 3));

    if (normals.length > 0) {
      setAttribute.call(geo, 'normal', new BufferAttribute(normals, 3));
    }

    if (uvs.length > 0) {
      setAttribute.call(geo, 'uv', new BufferAttribute(uvs, 2));
    }

    if (skinIndexArr.length > 0) {
      setAttribute.call(geo, 'skinIndex', new BufferAttribute(skinIndexArr, 4));
    }

    if (skinWeightArr.length > 0) {
      setAttribute.call(geo, 'skinWeight', new BufferAttribute(skinWeightArr, 4));
    }
  }

  console.log(
    'Result mesh ' + geometry.name + ' sizes:',
    'vertices',
    vertexLength,
    'normals',
    normals.length,
    'uv',
    uvs.length
  );

  // TODO: import cost worker code locally
  // console.timeEnd('Mesh simplification');
  // if (typeof SharedArrayBuffer === 'undefined') {
  //   // simulate worker
  //   const totalWorkers = 1;
  //   const workerIndex = 1;
  //   const range = Math.floor(geometry.attributes.position.count / totalWorkers);
  //   const start = range * workerIndex;
  //   const end = start + range;

  //   computeLeastCosts(dataArrays, 0, geometry.attributes.position.count);
  //   collapseLeastCostEdges(
  //     undefined,
  //     undefined,
  //     percentage,
  //     dataArrays,
  //     undefined,
  //     preserveTexture,
  //     start,
  //     end
  //   );
  //   return;
  // }
  // console.log('before:', geometry.faces.length);
  // console.log('after:', newGeo.faces.length);
  // console.log(
  //   'savings:',
  //   100 - (100 / geometry.faces.length) * newGeo.faces.length,
  //   '%'
  // );
  return geo;
}

// used when entire attribute is indexed by face not vertex
// i.e. all uvs for this face occupying 6 places
function copyItemFromBufferAttribute(
  arrSrc,
  arrDst,
  itemSize,
  srcIndex,
  dstIndex
) {
  // for each vertex
  for (var vId = 0; vId < 3; vId++) {
    // let offset = faces[i * 3 + vId] * itemSize;
    let offset = srcIndex * itemSize * 3;
    // for entire itemSize
    for (var j = 0, jl = itemSize; j < jl; j++) {
      const index = vId * itemSize + j; // sequential number itemSize * vertex if itemSize is 3 then from 0-8, if 4 then 0-11

      arrDst[dstIndex * 3 * itemSize + index] = arrSrc[offset + index];
    }
  }
}

// used with lookup in index
function copyItemFromBufferAttributeWithIndex(
  index,
  arrSrc,
  arrDst,
  itemSize,
  srcIndex,
  dstIndex
) {
  // for each vertex
  for (var vId = 0; vId < 3; vId++) {
    let offset = index[srcIndex * 3 + vId] * itemSize;
    // for entire itemSize
    for (var j = 0, jl = itemSize; j < jl; j++) {
      const index = vId * itemSize + j;

      arrDst[dstIndex * 3 * itemSize + index] = arrSrc[offset + j];
    }
  }
}

// used with lookup in index
function copyItemFromBufferAttributeWithIndexVertex(
  index,
  arrSrc,
  arrDst,
  itemSize,
  srcIndex,
  dstIndex,
  vId,
  oldToNewMapping
) {
  let offset = index[srcIndex * 3 + vId] * itemSize;
  // for entire itemSize
  for (var j = 0, jl = itemSize; j < jl; j++) {
    const index = vId * itemSize + j;

    arrDst[dstIndex * 3 * itemSize + index] = arrSrc[offset + j];
  }
}

// taken from Geometry.mergeVertices to merge positions in buffer geometry
function mergeBGVertices(attributes, targetPositions, targetFaces, targetUVs) {
  var verticesMap = {}; // Hashmap for looking up vertices by position coordinates (and making sure they are unique)
  var unique = [],
    changes = [];

  var vX, vY, vZ, key;
  var precisionPoints = 4; // number of decimal points, e.g. 4 for epsilon of 0.0001
  var precision = Math.pow(10, precisionPoints);
  var i, il, face;
  var indices, j, jl;

  var uniquePositions = 0;

  for (i = 0, il = attributes.position.count; i < il; i++) {
    vX = attributes.position.array[i * 3];
    vY = attributes.position.array[i * 3 + 1];
    vZ = attributes.position.array[i * 3 + 2];
    key =
      Math.round(vX * precision) +
      '_' +
      Math.round(vY * precision) +
      '_' +
      Math.round(vZ * precision);

    if (verticesMap[key] === undefined) {
      verticesMap[key] = i;
      // unique.push(this.vertices[i]);
      targetPositions[uniquePositions * 3] = vX;
      targetPositions[uniquePositions * 3 + 1] = vY;
      targetPositions[uniquePositions * 3 + 2] = vZ;

      changes[i] = vX; // unique.length - 1;
    } else {
      //console.log('Duplicate vertex found. ', i, ' could be using ', verticesMap[key]);
      changes[i] = changes[verticesMap[key]];
    }
  }

  // faces do not exists in buffergeometry
  // if faces are completely degenerate after merging vertices, we
  // have to remove them from the geometry.
  var faceIndicesToRemove = [];

  for (i = 0, il = this.faces.length; i < il; i++) {
    face = this.faces[i];

    face.a = changes[face.a];
    face.b = changes[face.b];
    face.c = changes[face.c];

    indices = [face.a, face.b, face.c];

    // if any duplicate vertices are found in a Face3
    // we have to remove the face as nothing can be saved
    for (var n = 0; n < 3; n++) {
      if (indices[n] === indices[(n + 1) % 3]) {
        faceIndicesToRemove.push(i);
        break;
      }
    }
  }

  for (i = faceIndicesToRemove.length - 1; i >= 0; i--) {
    var idx = faceIndicesToRemove[i];

    this.faces.splice(idx, 1);

    for (j = 0, jl = this.faceVertexUvs.length; j < jl; j++) {
      this.faceVertexUvs[j].splice(idx, 1);
    }
  }

  // Use unique set of vertices

  var diff = this.vertices.length - unique.length;
  this.vertices = unique;
  return diff;
}

export default meshSimplifier;
