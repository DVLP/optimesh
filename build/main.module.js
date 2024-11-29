import * as dvlpThree from 'dvlp-three';
// BELOW FLAT ARRAYS MANAGER
const FIELDS_OVERSIZE = 500;
const OVERSIZE_CONTAINER_CAPACITY = 2000;

function emptyOversizedContainer(container) {
  for (var i = 0; i < OVERSIZE_CONTAINER_CAPACITY; i++) {
    container[i * FIELDS_OVERSIZE] = -1;
  }
}

function emptyOversizedContainerIndex(containerIndex) {
  for (var i = 0; i < containerIndex.length; i++) {
    containerIndex[i] = -1;
  }
}

var simplify_worker = () => {
  let FIELDS_NO = 0; // do not change this will be set with a message from main thread
  let FIELDS_OVERSIZE = 0;
  let OVERSIZE_CONTAINER_CAPACITY = 0;
  let reportWorkerId = 0;
  let reportTotalWorkers = 0;
  let reattemptIntervalMs = 250;
  let reattemptIntervalCount = 20;
  let currentReqId = -1;
  let previousDataArrayViews = null;

  console.limited = (msg) => {
    if (!console.counters[msg]) {
      console.counters[msg] = 0;
    }
    console.counters[msg]++;

    if (console.counters[msg] < 10) {
      console.log(msg);
    } else if (console.counters[msg] === 100) {
      console.log(msg, 'x100');
    } else if (console.counters[msg] === 1000) {
      console.log(msg, 'x1000');
    } else if (console.counters[msg] === 10000) {
      console.log(msg, 'x10000');
    } else if (console.counters[msg] === 100000) {
      console.log(msg, 'x100000');
    } else if (console.counters[msg] === 1000000) {
      console.log(msg, 'x1000000');
    }
  };

  self.onmessage = function (e) {
    var functionName = e.data.task;
    if (functionName && self[functionName]) {
      self[functionName](
        e.data
        // buildCallback(functionName, e.data.reqId, e.data.time)
      );
    } else if (functionName !== 'init') {
      console.warn(
        'functionName: ',
        functionName,
        'not supported or not exported'
      );
    }
  };

  self['load'] = load;
  function load(data) {
    freeDataArrayRefs();
    console.counters = {};

    const dataArrayViews = {
      costStore: data.costStore,
      boneCosts: data.boneCosts,
      verticesView: data.verticesView,
      facesView: data.facesView,
      facesUVsView: data.facesUVsView,
      skinWeight: data.skinWeight,
      skinIndex: data.skinIndex,
      faceNormalsView: data.faceNormalsView,
      faceNormalView: data.faceNormalView,
      neighbourCollapse: data.neighbourCollapse,
      faceMaterialIndexView: data.faceMaterialIndexView,
      vertexFacesView: data.vertexFacesView,
      vertexNeighboursView: data.vertexNeighboursView,
      vertexWorkStatus: data.vertexWorkStatus,
      buildIndexStatus: data.buildIndexStatus,
      costCountView: data.costCountView,
      costTotalView: data.costTotalView,
      costMinView: data.costMinView,
      id: data.id,
      specialCases: data.specialCases,
      specialCasesIndex: data.specialCasesIndex,
      specialFaceCases: data.specialFaceCases,
      specialFaceCasesIndex: data.specialFaceCasesIndex,
      modelSizeFactor: (1 / data.modelSize) * 10,
      maximumCost: data.maximumCost || 10
    };
    dataArrayViews.collapseQueue = new Uint32Array(150);

    previousDataArrayViews = dataArrayViews;

    const workerIndex = data.workerIndex;
    const totalWorkers = data.totalWorkers;
    FIELDS_NO = data.FIELDS_NO;
    FIELDS_OVERSIZE = data.FIELDS_OVERSIZE;
    OVERSIZE_CONTAINER_CAPACITY = data.OVERSIZE_CONTAINER_CAPACITY;

    reportWorkerId = workerIndex;
    reportTotalWorkers = totalWorkers;
    currentReqId = data.reqId;

    let range = Math.floor(
      dataArrayViews.verticesView.length / 3 / totalWorkers
    );

    let remiander = range % 3;
    range -= remiander;

    let start = range * workerIndex;
    let end = start + range;

    if (workerIndex === totalWorkers - 1) {
      end += remiander * workerIndex;
    }

    if (start % 3 !== 0) {
      throw new Error('starting range not divisible by 3');
    }

    let buildRange = Math.floor(dataArrayViews.facesView.length / totalWorkers);

    remiander = buildRange % 3;
    buildRange -= remiander;

    let buildStart = buildRange * workerIndex;
    let buildEnd = buildStart + buildRange;

    if (workerIndex === totalWorkers - 1) {
      buildEnd += remiander * workerIndex;
    }

    if (buildStart % 3 !== 0) {
      throw new Error('starting range not divisible by 3');
    }

    console.log('Build start and range', buildStart, buildRange);

    buildVertexNeighboursIndex(
      dataArrayViews.facesView,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialCases,
      dataArrayViews.specialCasesIndex,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex,
      buildStart,
      buildEnd
    );

    dataArrayViews.buildIndexStatus[workerIndex] = 1;

    computeLeastCostWhenReady(
      dataArrayViews,
      data,
      start,
      end,
      workerIndex,
      totalWorkers,
      data.reqId
    );
  }

  function exitWithError(reqId, err) {
    freeDataArrayRefs();

    console.error(err);
    self.postMessage({
      task: 'simplificationError',
      reqId,
      message: err
    });
  }

  function freeDataArrayRefs() {
    if (previousDataArrayViews) {
      for (var key in previousDataArrayViews) {
        delete previousDataArrayViews[key];
      }
      previousDataArrayViews = null;
    }
  }

  function computeLeastCostWhenReady(
    dataArrayViews,
    data,
    start,
    end,
    workerIndex,
    totalWorkers,
    reqId,
    attempt = 0
  ) {
    if (reqId !== currentReqId) {
      throw new Error('Mixing shit!');
    }
    for (var i = 0; i < totalWorkers; i++) {
      if (dataArrayViews.buildIndexStatus[i] < 1) {
        const nextAttempt = attempt + 1;
        if (nextAttempt > reattemptIntervalCount) {
          const err =
            'Waited for other processes to build indexes for over ' +
            reattemptIntervalMs * reattemptIntervalCount +
            'iterations. Aborting';
          exitWithError(reqId, err);
          return;
        }

        const cb = function () {
          computeLeastCostWhenReady(
            dataArrayViews,
            data,
            start,
            end,
            workerIndex,
            totalWorkers,
            reqId,
            nextAttempt
          );
        };
        setTimeout(cb, reattemptIntervalMs);
        return;
      }
    }
    try {
      computeLeastCosts(dataArrayViews, start, end);
    } catch (e) {
      exitWithError(reqId, e.message || e);
      return;
    }

    dataArrayViews.buildIndexStatus[workerIndex] = 2;
    collapseWhenReady(
      dataArrayViews,
      data,
      start,
      end,
      workerIndex,
      totalWorkers,
      reqId
    );
    return;
  }

  function collapseWhenReady(
    dataArrayViews,
    data,
    start,
    end,
    workerIndex,
    totalWorkers,
    reqId,
    attempt = 0
  ) {
    if (reqId !== currentReqId) {
      throw new Error('Mixing shit!');
    }
    for (var i = 0; i < totalWorkers; i++) {
      if (dataArrayViews.buildIndexStatus[i] < 2) {
        const nextAttempt = attempt + 1;
        if (nextAttempt > reattemptIntervalCount) {
          const err =
            'Waited for other processes to compute costs for over ' +
            reattemptIntervalMs * reattemptIntervalCount +
            'ms iterations. Aborting';
          exitWithError(reqId, err);
          return;
        }
        const cb = function () {
          collapseWhenReady(
            dataArrayViews,
            data,
            start,
            end,
            workerIndex,
            totalWorkers,
            reqId,
            nextAttempt
          );
        };
        setTimeout(cb, reattemptIntervalMs);
        return;
      }
    }
    // // need special cases before can collapse
    try {
      collapseLeastCostEdges(
        data.percentage,
        dataArrayViews,
        data.preserveTexture,
        start,
        end
      );
    } catch (e) {
      return exitWithError(reqId, e.message || e);
    }

    let ifNoSABUseTransferable = undefined;
    if (self.SharedArrayBuffer === undefined) {
      ifNoSABUseTransferable = Object.keys(dataArrayViews).reduce((acc, el) => {
        dataArrayViews[el].buffer && acc.push(dataArrayViews[el].buffer);
        return acc;
      }, []);
      self.postMessage(
        { task: 'edgesCostsDone', reqId, dataArrays: dataArrayViews },
        ifNoSABUseTransferable
      );
    } else {
      freeDataArrayRefs();
      self.postMessage({ task: 'edgesCostsDone', reqId });
    }
  }

  function bufferArrayPushIfUnique(array, object) {
    for (var i = 1, il = array[0]; i <= il; i++) {
      if (array[i] === object) {
        return;
      }
    }
    array[il + 1] = object;
    array[0]++;
    // if (array.indexOf(object) === -1) array.push(object);
  }

  function bufferArrayPush(array, el1, el2) {
    const length = array[0];
    array[length + 1] = el1;
    array[length + 2] = el2;

    array[0] += 2;
    // if (array.indexOf(object) === -1) array.push(object);
  }

  function bufferArrayIncludes(array, el) {
    for (var i = 1, il = array[0]; i <= il; i++) {
      if (array[i] === el) {
        return true;
      }
    }
    return false;
  }

  function buildVertexNeighboursIndex(
    facesView,
    target,
    vertexFacesView,
    specialCases,
    specialCasesIndex,
    specialFaceCases,
    specialFaceCasesIndex,
    from,
    to
  ) {
    // each face takes 3 fields a. b. c vertices ids
    for (var i = from; i < to; i += 3) {
      const faceId = i / 3;
      setVertexNeighboursAtIndex(
        facesView[i],
        facesView[i + 1],
        target,
        specialCases,
        specialCasesIndex
      );
      setVertexNeighboursAtIndex(
        facesView[i],
        facesView[i + 2],
        target,
        specialCases,
        specialCasesIndex
      );

      setVertexNeighboursAtIndex(
        facesView[i + 1],
        facesView[i],
        target,
        specialCases,
        specialCasesIndex
      );
      setVertexNeighboursAtIndex(
        facesView[i + 1],
        facesView[i + 2],
        target,
        specialCases,
        specialCasesIndex
      );

      setVertexNeighboursAtIndex(
        facesView[i + 2],
        facesView[i],
        target,
        specialCases,
        specialCasesIndex
      );
      setVertexNeighboursAtIndex(
        facesView[i + 2],
        facesView[i + 1],
        target,
        specialCases,
        specialCasesIndex
      );

      setVertexFaceAtIndex(
        facesView[i],
        faceId,
        vertexFacesView,
        specialFaceCases,
        specialFaceCasesIndex
      );
      setVertexFaceAtIndex(
        facesView[i + 1],
        faceId,
        vertexFacesView,
        specialFaceCases,
        specialFaceCasesIndex
      );
      setVertexFaceAtIndex(
        facesView[i + 2],
        faceId,
        vertexFacesView,
        specialFaceCases,
        specialFaceCasesIndex
      );
    }
  }
  function replaceVertex(
    faceId,
    oldvId,
    newvId,
    facesView,
    vertexFacesView,
    vertexNeighboursView,
    specialCases,
    specialCasesIndex,
    specialFaceCases,
    specialFaceCasesIndex,
    dataArrayViews
  ) {
    if (faceId === -1 || oldvId === -1 || newvId === -1) {
      throw new Error('something is -1!!!!');
    }
    if (
      facesView[
        faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView)
      ] !== oldvId
    ) {
      throw new Error(
        'Replacing vertex in wrong place! ',
        oldvId,
        facesView[
          faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView)
        ],
        newvId
      );
    }

    const replacedPosition =
      faceId * 3 + getVertexIndexOnFaceId(faceId, oldvId, facesView);

    dataArrayViews.costStore[oldvId] = 99999;

    // TODO: is this still needed
    removeFaceFromVertex(
      oldvId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );

    setVertexFaceAtIndex(
      newvId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );

    const v1 = facesView[faceId * 3];
    const v2 = facesView[faceId * 3 + 1];
    const v3 = facesView[faceId * 3 + 2];

    let remaining1, remaining2;
    if (oldvId === v1) {
      remaining1 = v2;
      remaining2 = v3;
    } else if (oldvId === v2) {
      remaining1 = v1;
      remaining2 = v3;
    } else if (oldvId === v3) {
      remaining1 = v2;
      remaining2 = v3;
    } else {
      throw new Error('WTF');
    }
    facesView[replacedPosition] = newvId;

    removeVertexIfNonNeighbor(oldvId, remaining1, dataArrayViews);
    removeVertexIfNonNeighbor(remaining1, oldvId, dataArrayViews);

    removeVertexIfNonNeighbor(oldvId, remaining2, dataArrayViews);
    removeVertexIfNonNeighbor(remaining2, oldvId, dataArrayViews);

    removeVertexIfNonNeighbor(oldvId, newvId, dataArrayViews);
    removeVertexIfNonNeighbor(newvId, oldvId, dataArrayViews);

    // should they be set as neighbours afer removing?
    setVertexNeighboursAtIndex(
      remaining1,
      newvId,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      newvId,
      remaining1,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );

    setVertexNeighboursAtIndex(
      remaining2,
      newvId,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    setVertexNeighboursAtIndex(
      newvId,
      remaining2,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
    // setVertexNeighboursAtIndex(
    //   newvId,
    //   newvId,
    //   vertexNeighboursView,
    //   specialCases,
    //   specialCasesIndex
    // );

    computeFaceNormal(faceId, facesView, dataArrayViews.verticesView);
  }

  function getVertexOnFaceId(faceId, facesView, verticesView, index, target) {
    const vertexId = facesView[faceId * 3 + index];
    target.set(
      verticesView[vertexId * 3],
      verticesView[vertexId * 3 + 1],
      verticesView[vertexId * 3 + 2]
    );
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

  function removeVertexFromNeighbour(
    atIndex,
    neighbourIndex,
    target,
    specialCases,
    specialCasesIndex
  ) {
    removeFieldFromSBWithOversize(
      atIndex,
      neighbourIndex,
      target,
      specialCases,
      specialCasesIndex
    );
    removeFieldFromSBWithOversize(
      neighbourIndex,
      atIndex,
      target,
      specialCases,
      specialCasesIndex
    );
  }

  function removeFromNeighboursIndex(
    atIndex,
    target,
    specialCases,
    specialCasesIndex
  ) {
    const index = atIndex * FIELDS_NO;
    let count = target[index];

    for (var i = 0; i < count; i++) {
      const neighbourId = getFromBigData(
        atIndex,
        i,
        target,
        specialCases,
        specialCasesIndex
      );
      removeFieldFromSBWithOversize(
        neighbourId,
        atIndex,
        target,
        specialCases,
        specialCasesIndex
      );
    }
    return;
  }
  function removeFaceFromVertex(
    vertexId,
    faceId,
    vertexFacesView,
    specialFaceCases,
    specialFaceCasesIndex
  ) {
    return removeFieldFromSBWithOversize(
      vertexId,
      faceId,
      vertexFacesView,
      specialFaceCases,
      specialFaceCasesIndex
    );
  }

  function getFromBigData(
    parentId,
    childId,
    storage,
    oversizeStorage,
    oversizeStorageIndex
  ) {
    // childId is 0 indexed!
    const childIndex = childId + 1;
    const index = parentId * FIELDS_NO + childIndex;
    if (childIndex <= FIELDS_NO - 1) {
      return storage[index];
    } else {
      const index = oversizeStorageIndex[parentId];
      const offset = index * FIELDS_OVERSIZE - (FIELDS_NO - 1);
      if (offset + childIndex < index * FIELDS_OVERSIZE) {
        throw new Error('this should never happen');
      }
      return oversizeStorage[offset + childIndex];
    }
  }

  function removeVertexIfNonNeighbor(vertexId, neighbourId, dataArrayViews) {
    const {
      facesView,
      vertexFacesView,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    } = dataArrayViews;
    // location both for facesView and vertexNeighboursView
    const locationIndex = vertexId * FIELDS_NO;
    const count = vertexFacesView[locationIndex];

    for (var i = 0; i < count; i++) {
      const faceId = getFaceIdByVertexAndIndex(vertexId, i, dataArrayViews);
      if (faceIdHasVertexId(faceId, neighbourId, facesView)) return;
    }

    removeVertexFromNeighbour(
      vertexId,
      neighbourId,
      vertexNeighboursView,
      specialCases,
      specialCasesIndex
    );
  }

  function setVertexNeighboursAtIndex(
    atIndex,
    neighbourIndex,
    target,
    specialCases,
    specialCasesIndex
  ) {
    addToSBWithOversize(
      atIndex,
      neighbourIndex,
      target,
      specialCases,
      specialCasesIndex
    );
  }

  function setVertexFaceAtIndex(
    atIndex,
    faceIndex,
    target,
    specialFaceCases,
    specialFaceCasesIndex
  ) {
    addToSBWithOversize(
      atIndex,
      faceIndex,
      target,
      specialFaceCases,
      specialFaceCasesIndex
    );
  }

  function computeLeastCosts(dataArrayViews, fromIndex, toIndex) {
    // compute all edge collapse costs
    for (let i = fromIndex; i < toIndex; i++) {
      computeEdgeCostAtVertex(i, dataArrayViews);
    }

    // buildFullIndex(
    //   dataArrayViews.costStore,
    //   dataArrayViews.collapseQueue,
    //   fromIndex,
    //   toIndex
    // );

    // // create collapseQueue
    // // let costsOrdered = new Float32Array(toIndex - fromIndex);
    // let costsOrderedIndexes = new Float32Array(toIndex - fromIndex);

    // for (var i = fromIndex; i < toIndex; i++) {
    //   // costsOrdered[i - fromIndex] = dataArrayViews.costStore[i];
    //   costsOrderedIndexes[i - fromIndex] = i;
    // }

    // // sort indexes
    // costsOrderedIndexes.sort((a, b) =>
    //   dataArrayViews.costStore[a] < dataArrayViews.costStore[b]
    //     ? -1
    //     : (dataArrayViews.costStore[b] < dataArrayViews.costStore[a]) | 0
    // );

    // for (i = 0; i < 100; i++) {
    //   if (i === 0) {
    //     dataArrayViews.collapseQueue[0] = 1;
    //     continue;
    //   }
    //   dataArrayViews.collapseQueue[i] = costsOrderedIndexes[i - 1];
    // }
  }

  // function insertToCollapseQueue(vId, dataArrayViews) {
  //   const collapseArr = dataArrayViews.collapseQueue;
  //   let foundEmptyIndex = 0;
  //   for (var i = 1, il = dataArrayViews.collapseQueue.length; i < il; i++) {
  //     if (dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] === 99999) {
  //       foundEmptyIndex = i;
  //     }
  //     if (
  //       dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] !== 99999 &&
  //       dataArrayViews.costStore[dataArrayViews.collapseQueue[i]] >
  //         dataArrayViews.costStore[vId]
  //     ) {
  //       debugger;
  //       dataArrayViews.collapseQueue[i] = vId;

  //       if (dataArrayViews.collapseQueue[0] >= i) {
  //         dataArrayViews.collapseQueue[0]++;
  //       }
  //       if (!foundEmptyIndex) {
  //         shiftArray(collapseArr, i, collapseArr.length, true);
  //       } else {
  //         shiftArray(collapseArr, foundEmptyIndex, i, false);
  //       }
  //       return;
  //     }
  //   }
  // }

  // function shiftArray(arr, shiftPoint, shiftPointEnd, directionForward) {
  //   for (var i = shiftPoint; i < shiftPointEnd; i++) {
  //     if (directionForward) {
  //       arr[i + 1] = arr[i];
  //     } else {
  //       arr[i] = arr[i + 1];
  //     }
  //   }
  // }

  function computeEdgeCostAtVertex(vId, dataArrayViews) {
    // compute the edge collapse cost for all edges that start
    // from vertex v.  Since we are only interested in reducing
    // the object by selecting the min cost edge at each step, we
    // only cache the cost of the least cost edge at this vertex
    // (in member variable collapse) as well as the value of the
    // cost (in member variable collapseCost).

    const neighboursView = dataArrayViews.vertexNeighboursView;
    const count = neighboursView[vId * FIELDS_NO];

    if (count === 0) {
      // collapse if no neighbors.
      dataArrayViews.neighbourCollapse[vId] = -1;
      // dataArrayViews.costStore[vId] = 0;
      removeVertex(vId, dataArrayViews);

      return;
    }

    dataArrayViews.costStore[vId] = 100000;
    dataArrayViews.neighbourCollapse[vId] = -1;

    // search all neighboring edges for 'least cost' edge
    for (var i = 0; i < count; i++) {
      const nextNeighbourId = getVertexNeighbourByIndex(vId, i, dataArrayViews);
      var collapseCost = tryComputeEdgeCollapseCost(
        vId,
        nextNeighbourId,
        dataArrayViews
      );

      if (dataArrayViews.neighbourCollapse[vId] === -1) {
        dataArrayViews.neighbourCollapse[vId] = nextNeighbourId;
        dataArrayViews.costStore[vId] = collapseCost;

        dataArrayViews.costMinView[vId] = collapseCost;
        dataArrayViews.costTotalView[vId] = 0;
        dataArrayViews.costCountView[vId] = 0;
      }

      dataArrayViews.costCountView[vId]++;
      dataArrayViews.costTotalView[vId] += collapseCost;
      if (collapseCost < dataArrayViews.costMinView[vId]) {
        dataArrayViews.neighbourCollapse[vId] = nextNeighbourId;
        dataArrayViews.costMinView[vId] = collapseCost;
      }
    }

    const cost =
      dataArrayViews.costTotalView[vId] / dataArrayViews.costCountView[vId];

    // we average the cost of collapsing at this vertex
    dataArrayViews.costStore[vId] = cost;

    // if (
    //   !dataArrayViews.collapseQueue.includes(vId) &&
    //   dataArrayViews.collapseQueue[0] !== 0 &&
    //   cost <
    //     dataArrayViews.costStore[
    //       dataArrayViews.collapseQueue[dataArrayViews.collapseQueue.length - 1]
    //     ]
    // ) {
    //   insertToCollapseQueue(
    //     vId,
    //     dataArrayViews.costStore,
    //     dataArrayViews.collapseQueue
    //   );
    // }
  }

  function faceIdHasVertexId(faceId, vertexId, facesView) {
    if (facesView[faceId * 3] === vertexId) return true;
    if (facesView[faceId * 3 + 1] === vertexId) return true;
    if (facesView[faceId * 3 + 2] === vertexId) return true;

    return false;
  }

  const posA = new Vector3();
  const posB = new Vector3();
  function tryComputeEdgeCollapseCost(uId, vId, dataArrayViews, attempt = 0) {
    // if (
    //   dataArrayViews.vertexWorkStatus[uId] > 0 ||
    //   dataArrayViews.vertexWorkStatus[vId] > 0
    // ) {
    // console.log('Busy now and cant recalculate');
    // return tryComputeEdgeCollapseCost(uId, vId, dataArrayViews);
    // }
    try {
      return computeEdgeCollapseCost(uId, vId, dataArrayViews);
    } catch (e) {
      if (attempt < 10) {
        throw e;
        // const nextAttempt = attempt + 1;
        // return tryComputeEdgeCollapseCost(
        //   uId,
        //   vId,
        //   dataArrayViews,
        //   nextAttempt
        // );
      }
      console.log('PICK UP FROM HERE , WTF IS HAPPENING');
      throw e;
    }
  }
  var sideFaces = new Int32Array(2);
  var faceNormal = new Vector3();
  var sideFaceNormal = new Vector3();
  function computeEdgeCollapseCost(uId, vId, dataArrayViews) {
    // if we collapse edge uv by moving u to v then how
    // much different will the model change, i.e. the 'error'.
    posA.set(
      dataArrayViews.verticesView[vId * 3],
      dataArrayViews.verticesView[vId * 3 + 1],
      dataArrayViews.verticesView[vId * 3 + 2]
    );
    posB.set(
      dataArrayViews.verticesView[uId * 3],
      dataArrayViews.verticesView[uId * 3 + 1],
      dataArrayViews.verticesView[uId * 3 + 2]
    );
    var edgelengthSquared = posA.distanceToSquared(posB);

    const edgeCost =
      Math.sqrt(edgelengthSquared) * dataArrayViews.modelSizeFactor;
    // edge length cost 0-10, if more than 2(20% of object size stop)
    if (edgeCost > 2) {
      console.limited('Absolute limit of edge cost reached');
      return 10000;
    }

    var curvature = 0;

    sideFaces[0] = -1;
    sideFaces[1] = -1;

    var vertexFaceCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];

    var i,
      il = vertexFaceCount;

    // FIND if we're pulling an edge
    // end of collapsed edge should not end with
    // edges around moved vertex must have 2 triangles on both sides

    // find the 'sides' triangles that are on the edge uv
    for (i = 0; i < il; i++) {
      var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      if (faceIdHasVertexId(faceId, vId, dataArrayViews.facesView)) {
        if (sideFaces[0] === -1) {
          var boneCost = computeBoneCost(faceId, i, dataArrayViews);
          sideFaces[0] = faceId;
        } else {
          sideFaces[1] = faceId;
        }
      }
    }

    // use the triangle facing most away from the sides
    // to determine our curvature term
    for (i = 0; i < il; i++) {
      var minCurvature = 1;
      var faceId2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);

      for (var j = 0; j < sideFaces.length; j++) {
        var sideFaceId = sideFaces[j];
        if (sideFaceId === -1) continue;
        sideFaceNormal.set(
          dataArrayViews.faceNormalView[sideFaceId * 3],
          dataArrayViews.faceNormalView[sideFaceId * 3 + 1],
          dataArrayViews.faceNormalView[sideFaceId * 3 + 2]
        );
        faceNormal.set(
          dataArrayViews.faceNormalView[faceId2 * 3],
          dataArrayViews.faceNormalView[faceId2 * 3 + 1],
          dataArrayViews.faceNormalView[faceId2 * 3 + 2]
        );

        // use dot product of face normals.
        var dotProd = faceNormal.dot(sideFaceNormal);
        minCurvature = Math.min(minCurvature, (1.001 - dotProd) * 0.5);
      }
      curvature = Math.max(curvature, minCurvature);
    }

    // maximum allowed curvature to be culled
    if (curvature > 1) {
      return 1000;
    }

    // crude approach in attempt to preserve borders
    // though it seems not to be totally correct
    var borders = 0;
    if (sideFaces[0] === -1 || sideFaces[1] === -1) {
      // we add some arbitrary cost for borders,
      //borders += 1;
      curvature += 10;
    }

    var costUV = computeUVsCost(uId, vId, dataArrayViews);
    if (costUV > 3) {
      return 1234;
    }
    var amt =
      edgelengthSquared * curvature * curvature +
      borders * borders +
      costUV * costUV;

    // var amt =
    //   edgeCost + // compute bounding box from vertices first and use max size to affect edge length param
    //   curvature * 10 + // float 0 - 10 what if curvature is less than 1 ? it will cause
    //   // borders * borders +
    //   (costUV + costUV); // integer - always > 1 // what if cost uv is less than 1 ? it will cause

    return amt * boneCost;
  }

  function getVertexNeighbourByIndex(vId, neighbourIndex, dataArrayViews) {
    return getFromBigData(
      vId,
      neighbourIndex,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialCasesIndex
    );
  }

  function getFaceIdByVertexAndIndex(vId, i, dataArrayViews) {
    return getFromBigData(
      vId,
      i,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );
  }

  var UVsAroundVertex = new Float32Array(500);
  const costTemp = new Float32Array(2);
  var facesCount = 0;
  var vertexIndexOnFace = -1;
  function getUVCost(array) {
    let cost = 0;
    for (var i = 1; i < array[0]; i += 2) {
      if (i > 0 && (costTemp[0] !== array[i] || costTemp[1] !== array[i + 1])) {
        cost += 1;
      }
      costTemp[0] = array[i];
      costTemp[1] = array[i + 1];
    }
    return cost;
  }
  // check if there are multiple texture coordinates at U and V vertices(finding texture borders)
  function computeUVsCost(uId, vId, dataArrayViews) {
    // if (!u.faces[0].faceVertexUvs || !u.faces[0].faceVertexUvs) return 0;
    // if (!v.faces[0].faceVertexUvs || !v.faces[0].faceVertexUvs) return 0;
    // reset length
    UVsAroundVertex[0] = 0;

    facesCount = dataArrayViews.vertexFacesView[vId * FIELDS_NO];

    for (var i = facesCount - 1; i >= 0; i--) {
      var fid = getFaceIdByVertexAndIndex(vId, i, dataArrayViews);
      vertexIndexOnFace = getVertexIndexOnFaceId(
        fid,
        vId,
        dataArrayViews.facesView
      );
      if (faceIdHasVertexId(fid, uId, dataArrayViews.facesView)) {
        // UVsAroundVertex.push(getUVsOnVertexId(fid, vId, dataArrayViews));
        // getFromAttributeObj(
        //   dataArrayViews.facesUVsView,
        //   fid,
        //   vertexIndexOnFace,
        //   2,
        //   v2Tmp
        // );
        getFromAttributeTwoObj(
          dataArrayViews.facesUVsView,
          fid,
          vertexIndexOnFace,
          v2Tmp
        );
        bufferArrayPush(UVsAroundVertex, v2Tmp.x, v2Tmp.y);
      }
    }

    let UVcost = getUVCost(UVsAroundVertex);

    UVsAroundVertex[0] = 0;

    const facesCount2 = dataArrayViews.vertexFacesView[uId * FIELDS_NO];
    // check if all coordinates around U have the same value
    for (i = facesCount2 - 1; i >= 0; i--) {
      let fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      vertexIndexOnFace = getVertexIndexOnFaceId(
        fid2,
        uId,
        dataArrayViews.facesView
      );

      if (fid2 === undefined) {
        fid2 = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      }
      if (faceIdHasVertexId(fid2, vId, dataArrayViews.facesView)) {
        // getFromAttributeObj(
        //   dataArrayViews.facesUVsView,
        //   fid2,
        //   vertexIndexOnFace,
        //   2,
        //   v2Tmp
        // );
        getFromAttributeTwoObj(
          dataArrayViews.facesUVsView,
          fid2,
          vertexIndexOnFace,
          v2Tmp
        );
        bufferArrayPush(UVsAroundVertex, v2Tmp.x, v2Tmp.y);
      }
    }
    UVcost += getUVCost(UVsAroundVertex);
    return UVcost;
  }

  const tempSkinIndex = new Uint32Array(4);
  const tempSkinWeight = new Float32Array(4);
  function computeBoneCost(faceId, vertIndexOnFace, dataArrayViews) {
    let boneId = 0;
    let weight = 0;
    let boneCost = 0;
    let cost = 0;

    // getFromAttribute(
    //   dataArrayViews.skinIndex,
    //   faceId,
    //   vertIndexOnFace,
    //   4,
    //   tempSkinIndex
    // );
    // getFromAttribute(
    //   dataArrayViews.skinWeight,
    //   faceId,
    //   vertIndexOnFace,
    //   4,
    //   tempSkinWeight
    // );
    getFromAttributeFour(
      dataArrayViews.skinIndex,
      faceId,
      vertIndexOnFace,
      tempSkinIndex
    );
    getFromAttributeFour(
      dataArrayViews.skinWeight,
      faceId,
      vertIndexOnFace,
      tempSkinWeight
    );
    for (let i = 0; i < 4; i++) {
      // boneId = dataArrayViews.skinIndex[uId * 4 + i]
      // weight = dataArrayViews.skinWeight[uId * 4 + i]
      boneId = tempSkinIndex[i];
      weight = tempSkinWeight[i];
      boneCost = dataArrayViews.boneCosts[boneId] || 1;
      cost += boneCost * weight;
    }
    return cost || 1;
  }

  function removeVertex(vId, dataArrayViews) {
    removeFromNeighboursIndex(
      vId,
      dataArrayViews.vertexNeighboursView,
      dataArrayViews.specialCases,
      dataArrayViews.specialCasesIndex
    );
    dataArrayViews.costStore[vId] = 99999;
  }

  function removeFace(fid, dataArrayViews) {
    const v1 = dataArrayViews.facesView[fid * 3];
    const v2 = dataArrayViews.facesView[fid * 3 + 1];
    const v3 = dataArrayViews.facesView[fid * 3 + 2];

    // -1 means removed
    dataArrayViews.facesView[fid * 3] = -1;
    dataArrayViews.facesView[fid * 3 + 1] = -1;
    dataArrayViews.facesView[fid * 3 + 2] = -1;

    removeFaceFromVertex(
      v1,
      fid,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );
    removeFaceFromVertex(
      v2,
      fid,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );
    removeFaceFromVertex(
      v3,
      fid,
      dataArrayViews.vertexFacesView,
      dataArrayViews.specialFaceCases,
      dataArrayViews.specialFaceCasesIndex
    );

    removeVertexIfNonNeighbor(v1, v2, dataArrayViews);
    removeVertexIfNonNeighbor(v2, v1, dataArrayViews);
    removeVertexIfNonNeighbor(v1, v3, dataArrayViews);
    removeVertexIfNonNeighbor(v3, v1, dataArrayViews);
    removeVertexIfNonNeighbor(v2, v3, dataArrayViews);
    removeVertexIfNonNeighbor(v3, v2, dataArrayViews);
  }

  var moveToThisNormalValues = new Vector3();
  var moveToSkinIndex = new Uint32Array(4);
  var moveToSkinWeight = new Float32Array(4);
  var UVs = new Float32Array(2);
  var tmpVertices = new Uint32Array(500);
  var skipVertices = new Uint32Array(1000);
  var neighhbourId = 0;
  function collapse(uId, vId, preserveTexture, dataArrayViews) {
    // indicating that work is in progress on this vertex and neighbour (with which it creates about to be collapsed edge)
    // the neighbour might be in another worker's range or uId might be a neighbour of a vertex in another worker's range
    if (dataArrayViews.vertexWorkStatus[uId] !== 0) {
      throw 'Vertex uId availability status changed unexpectedly';
    }
    dataArrayViews.vertexWorkStatus[uId] = 1;
    if (vId !== null) {
      if (dataArrayViews.vertexWorkStatus[vId] !== 0) {
        throw 'Vertex vId availability status changed unexpectedly';
      }
      dataArrayViews.vertexWorkStatus[vId] = 1;
    }
    if (vId === null) {
      // u is a vertex all by itself so just delete it..
      removeVertex(uId, dataArrayViews);
      dataArrayViews.vertexWorkStatus[uId] = 3;
      return true;
    }

    const neighboursView = dataArrayViews.vertexNeighboursView;
    const neighboursCountV = neighboursView[vId * FIELDS_NO];
    const neighboursCountU = neighboursView[uId * FIELDS_NO];

    var i;
    tmpVertices[0] = 0;

    // find neighbours plus add temporary lock "2" on them
    for (i = 0; i < neighboursCountU; i++) {
      neighhbourId = getVertexNeighbourByIndex(uId, i, dataArrayViews);
      // skip currently processed neighbour
      if (vId === neighhbourId) continue;

      if (dataArrayViews.vertexWorkStatus[neighhbourId] === 1) {
        throw 'Neightbour is currently being worked on';
      }
      if (dataArrayViews.vertexWorkStatus[neighhbourId] === 2) {
        console.log('Works happening near this vertex, thats allowed');
      }
      if (dataArrayViews.vertexWorkStatus[neighhbourId] === 3) {
        throw 'Neightbour has been removed and should not be in neighbours';
      }
      dataArrayViews.vertexWorkStatus[neighhbourId] = 2;
      bufferArrayPushIfUnique(tmpVertices, neighhbourId);
    }

    // TODO: This might be unneccessary. Is there a need to actually recalculating ALL neighbours of not-removed vertex?
    // for (i = 0; i < neighboursCountV; i++) {
    //   neighhbourId = getVertexNeighbourByIndex(vId, i, dataArrayViews);
    //   dataArrayViews.vertexWorkStatus[neighhbourId] = 2;
    //   bufferArrayPushIfUnique(tmpVertices, neighhbourId);
    // }

    let facesCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];

    // delete triangles on edge uv:
    for (i = facesCount - 1; i >= 0; i--) {
      const faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
      if (faceIdHasVertexId(faceId, vId, dataArrayViews.facesView)) {
        const vertIndexOnFace = getVertexIndexOnFaceId(
          faceId,
          uId,
          dataArrayViews.facesView
        );
        const vertIndexOnFace2 = getVertexIndexOnFaceId(
          faceId,
          vId,
          dataArrayViews.facesView
        );
        if (preserveTexture) {
          // get uvs on remaining vertex
          // getFromAttribute(
          //   dataArrayViews.facesUVsView,
          //   faceId,
          //   vertIndexOnFace2,
          //   2,
          //   UVs
          // );
          getFromAttributeTwo(
            dataArrayViews.facesUVsView,
            faceId,
            vertIndexOnFace2,
            UVs
          );
        }

        // do not interpolate just move to V2
        // getFromAttributeObj(
        //   dataArrayViews.faceNormalsView,
        //   faceId,
        //   vertIndexOnFace2,
        //   3,
        //   moveToThisNormalValues
        // )
        getFromAttributeThreeObj(
          dataArrayViews.faceNormalsView,
          faceId,
          vertIndexOnFace2,
          moveToThisNormalValues
        );
        // moveToThisNormalValues
        //   .copy(
        //     getFromAttributeObj(
        //       dataArrayViews.faceNormalsView,
        //       faceId,
        //       vertIndexOnFace,
        //       3,
        //       v1Temp
        //     )
        //   )
        //   .lerp(
        //     getFromAttributeObj(
        //       dataArrayViews.faceNormalsView,
        //       faceId,
        //       vertIndexOnFace2,
        //       3,
        //       v2Temp
        //     ),
        //     0.5
        //   );

        // getFromAttribute(
        //   dataArrayViews.skinIndex,
        //   faceId,
        //   vertIndexOnFace2,
        //   4,
        //   moveToSkinIndex
        // );
        // getFromAttribute(
        //   dataArrayViews.skinWeight,
        //   faceId,
        //   vertIndexOnFace2,
        //   4,
        //   moveToSkinWeight
        // );
        getFromAttributeFour(
          dataArrayViews.skinIndex,
          faceId,
          vertIndexOnFace2,
          moveToSkinIndex
        );
        getFromAttributeFour(
          dataArrayViews.skinWeight,
          faceId,
          vertIndexOnFace2,
          moveToSkinWeight
        );

        removeFace(faceId, dataArrayViews);
      }
    }

    facesCount = dataArrayViews.vertexFacesView[uId * FIELDS_NO];
    if (preserveTexture && facesCount) {
      for (i = facesCount - 1; i >= 0; i--) {
        var faceId = getFaceIdByVertexAndIndex(uId, i, dataArrayViews);
        const vertIndexOnFace = getVertexIndexOnFaceId(
          faceId,
          uId,
          dataArrayViews.facesView
        );

        setOnAttribute(
          dataArrayViews.facesUVsView,
          faceId,
          vertIndexOnFace,
          0,
          UVs[0],
          2
        );
        setOnAttribute(
          dataArrayViews.facesUVsView,
          faceId,
          vertIndexOnFace,
          1,
          UVs[1],
          2
        );

        setOnAttribute(
          dataArrayViews.faceNormalsView,
          faceId,
          vertIndexOnFace,
          0,
          moveToThisNormalValues.x,
          3
        );
        setOnAttribute(
          dataArrayViews.faceNormalsView,
          faceId,
          vertIndexOnFace,
          1,
          moveToThisNormalValues.y,
          3
        );
        setOnAttribute(
          dataArrayViews.faceNormalsView,
          faceId,
          vertIndexOnFace,
          2,
          moveToThisNormalValues.z,
          3
        );

        for (var j = 0; j < 4; j++) {
          setOnAttribute(dataArrayViews.skinIndex, faceId, vertIndexOnFace, j, moveToSkinIndex[j], 4);
          setOnAttribute(dataArrayViews.skinWeight, faceId, vertIndexOnFace, j, moveToSkinWeight[j], 4);
        }
      }
    }

    // // TODO: did it reach face 0?
    // // update remaining triangles to have v instead of u
    for (i = facesCount - 1; i >= 0; i--) {
      replaceVertex(
        getFaceIdByVertexAndIndex(uId, i, dataArrayViews),
        uId,
        vId,
        dataArrayViews.facesView,
        dataArrayViews.vertexFacesView,
        dataArrayViews.vertexNeighboursView,
        dataArrayViews.specialCases,
        dataArrayViews.specialCasesIndex,
        dataArrayViews.specialFaceCases,
        dataArrayViews.specialFaceCasesIndex,
        dataArrayViews
      );
    }
    removeVertex(uId, dataArrayViews);
    // recompute the edge collapse costs in neighborhood
    for (var i = 1, il = tmpVertices[0]; i <= il; i++) {
      computeEdgeCostAtVertex(tmpVertices[i], dataArrayViews);
      // unlock temporarily locked neighbours
      if (dataArrayViews.vertexWorkStatus[tmpVertices[i]] === 2) {
        dataArrayViews.vertexWorkStatus[tmpVertices[i]] = 0;
      } else {
        console.limited(
          'other status!',
          dataArrayViews.vertexWorkStatus[tmpVertices[i]]
        );
      }
    }
    // vertexWorkStatus
    // 0 - ready for processing
    // 1 - busy
    // 2 - temporary lock for neighbours
    // 3 - removed

    // uid has been removed
    dataArrayViews.vertexWorkStatus[uId] = 3; // or maybe 2 to indicate that the work is done
    dataArrayViews.vertexWorkStatus[vId] = 0; // vId remains so definitely 0
    return true;
  }

  function setOnAttribute(
    attribute,
    faceId,
    vertexIndexOnFace,
    vertexId,
    value,
    itemSize
  ) {
    attribute[
      faceId * 3 * itemSize + vertexIndexOnFace * itemSize + vertexId
    ] = value;
  }

  // Do not use. Looks nice but this is a very hot place and the overhead of function calls is huge
  // function getFromAttribute(
  //   attribute,
  //   faceId,
  //   vertexIndexOnFace,
  //   itemSize,
  //   target
  // ) {
  //   for (var i = 0; i < itemSize; i++) {
  //     target[i] =
  //       attribute[faceId * 3 * itemSize + vertexIndexOnFace * itemSize + i];
  //   }
  // }

  function getFromAttributeTwo(
    attribute,
    faceId,
    vertexIndexOnFace,
    target
  ) {
    var offset = faceId * 3 * 2 + vertexIndexOnFace * 2;
    target[0] = attribute[offset];
    target[1] = attribute[offset + 1];
  }

  /** @inline */
  function getFromAttributeFour(
    attribute,
    faceId,
    vertexIndexOnFace,
    target
  ) {
    var offset = faceId * 3 * 4 + vertexIndexOnFace * 4;
    target[0] = attribute[offset];
    target[1] = attribute[offset + 1];
    target[2] = attribute[offset + 2];
    target[3] = attribute[offset + 3];
  }

  // looks nice but this is a very hot place and the overhead of function calls is huge
  // const tempArr = new Float32Array(4);
  // function getFromAttributeObj(
  //   attribute,
  //   faceId,
  //   vertexIndexOnFace,
  //   itemSize,
  //   target
  // ) {
  //   getFromAttribute(attribute, faceId, vertexIndexOnFace, itemSize, tempArr);
  //   return target.fromArray(tempArr);
  // }

  function getFromAttributeTwoObj(
    attribute,
    faceId,
    vertexIndexOnFace,
    target
  ) {
    var offset = faceId * 3 * 2 + vertexIndexOnFace * 2;
    target.x = attribute[offset];
    target.y = attribute[offset + 1];
  }

  function getFromAttributeThreeObj(
    attribute,
    faceId,
    vertexIndexOnFace,
    target
  ) {
    var offset = faceId * 3 * 3 + vertexIndexOnFace * 3;
    target.x = attribute[offset];
    target.y = attribute[offset + 1];
    target.z = attribute[offset + 2];
  }

  function getVertexIndexOnFaceId(faceId, vertexId, facesView) {
    if (vertexId === facesView[faceId * 3]) return 0;
    if (vertexId === facesView[faceId * 3 + 1]) return 1;
    if (vertexId === facesView[faceId * 3 + 2]) return 2;

    throw new Error(
      'Vertex not found ' +
        vertexId +
        ' faceid: ' +
        faceId +
        ' worker index ' +
        reportWorkerId +
        ' / ' +
        reportTotalWorkers
    );
  }

  function collapseLeastCostEdges(
    percentage,
    dataArrayViews,
    preserveTexture,
    from,
    to
  ) {
    // 1. get available workers (with mesh loaded)
    // 2. split the work between them up to vertices.length
    // 3. send a task computeEdgesCost(fromIndex, toIndex)
    // 4. when all return (with correct mesh id) proceed with collapsing
    const originalLength = to - from; // vertices.length;
    var nextVertexId;
    var howManyToRemove = Math.round(originalLength * percentage);
    var z = howManyToRemove;
    skipVertices[0] = 0;

    while (z--) {
      // after skipping 30 start again
      // WATNING: this causes infonite loop
      // if (skip > 30) {
      //   console.log('something is seriously wrong');
      // }
      const prevNextVertex = nextVertexId;
      nextVertexId = minimumCostEdge(from, to, skipVertices, dataArrayViews);
      if (prevNextVertex === nextVertexId) {
        console.warn(
          `No new vertex with least cost found! ${prevNextVertex} ${nextVertexId}`
        );
        break;
      }
      // nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
      // if (nextVertexId === false) {
      //   buildFullIndex(
      //     dataArrayViews.costStore,
      //     dataArrayViews.collapseQueue,
      //     from,
      //     to
      //   );
      //   nextVertexId = takeNextValue(dataArrayViews.collapseQueue);
      // }
      if (nextVertexId === false) {
        console.log(
          'skipVertices all the way or cost only > ',
          dataArrayViews.maximumCost
        );
        break;
      }

      if (
        dataArrayViews.vertexWorkStatus[nextVertexId] !== 0 &&
        dataArrayViews.vertexWorkStatus[nextVertexId] !== 2
      ) {
        console.limited('skip next vertex');
        z++;
        bufferArrayPushIfUnique(skipVertices, nextVertexId);

        // console.log('work on this one going. skipping');
        continue;
      }

      // if (nextVertexId < from || nextVertexId >= to) {
      //   console.log('skipping: ', nextVertexId);
      //   skip++;
      //   continue;
      // }
      const neighbourId = dataArrayViews.neighbourCollapse[nextVertexId];
      if (
        dataArrayViews.vertexWorkStatus[neighbourId] !== 0 &&
        dataArrayViews.vertexWorkStatus[neighbourId] !== 2
      ) {
        console.limited('skip next neighbour');
        z++;
        bufferArrayPushIfUnique(skipVertices, nextVertexId);
        // console.log('work on collapse neighbour going. skipping');
        continue;
      }
      try {
        collapse(nextVertexId, neighbourId, preserveTexture, dataArrayViews);
      } catch (e) {
        console.warn('not collapsed', e.message || e);
        // in case of an error add vertex to done but continue
        dataArrayViews.vertexWorkStatus[nextVertexId] = 3;
      }

      // TEMO: this kind of fixes but breaks everything
      // looks what's happening in CONSOLE.ASSERT
      // dataArrayViews.costStore[nextVertexId] = 9999;
    }
    // console.log(
    //   'Worker ',
    //   // workerIndex,
    //   ' removed ',
    //   collapsedCount,
    //   ' / ',
    //   howManyToRemove,
    //   ' / ',
    //   dataArrayViews.verticesView.length / 3
    // );
  }

  function minimumCostEdge(from, to, skipVertices, dataArrayViews) {
    // // O(n * n) approach. TODO optimize this
    var leastV = false;

    if (from >= to - 1) {
      return false;
    }

    for (var i = from; i < to; i++) {
      if (
        dataArrayViews.vertexWorkStatus[i] === 0 &&
        dataArrayViews.costStore[i] < dataArrayViews.maximumCost &&
        !bufferArrayIncludes(skipVertices, i)
      ) {
        if (leastV === false) {
          leastV = i;
        } else if (
          dataArrayViews.neighbourCollapse[i] !== -1 &&
          dataArrayViews.vertexWorkStatus[
            dataArrayViews.neighbourCollapse[i]
          ] === 0 &&
          dataArrayViews.costStore[i] < dataArrayViews.costStore[leastV]
        ) {
          leastV = i;
        }
      }
    }
    return leastV;
  }

  function Vector2(x, y) {
    this.x = x || 0;
    this.y = y || 0;
  }

  Vector2.prototype.copy = function (v) {
    this.x = v.x;
    this.y = v.y;

    return this;
  };

  Vector2.prototype.fromArray = function (array, offset) {
    if (offset === undefined) offset = 0;

    this.x = array[offset];
    this.y = array[offset + 1];

    return this;
  };

  function Vector3(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }

  Vector3.prototype.set = function (x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  };

  Vector3.prototype.isVector3 = true;

  Vector3.prototype.subVectors = function (a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;

    return this;
  };

  Vector3.prototype.cross = function (v, w) {
    if (w !== undefined) {
      console.warn(
        'THREE.Vector3: .cross() now only accepts one argument. Use .crossVectors( a, b ) instead.'
      );
      return this.crossVectors(v, w);
    }

    return this.crossVectors(this, v);
  };

  Vector3.prototype.crossVectors = function (a, b) {
    var ax = a.x,
      ay = a.y,
      az = a.z;
    var bx = b.x,
      by = b.y,
      bz = b.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;

    return this;
  };

  Vector3.prototype.lerp = function (v, alpha) {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;

    return this;
  };

  Vector3.prototype.multiplyScalar = function (scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;

    return this;
  };

  Vector3.prototype.divideScalar = function (scalar) {
    return this.multiplyScalar(1 / scalar);
  };

  Vector3.prototype.length = function () {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  };

  Vector3.prototype.normalize = function () {
    return this.divideScalar(this.length() || 1);
  };

  Vector3.prototype.copy = function (v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;

    return this;
  };

  Vector3.prototype.distanceToSquared = function (v) {
    var dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;
  };

  Vector3.prototype.dot = function (v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  };

  Vector3.prototype.clone = function () {
    return new this.constructor(this.x, this.y, this.z);
  };

  Vector3.prototype.sub = function (v, w) {
    if (w !== undefined) {
      console.warn(
        'THREE.Vector3: .sub() now only accepts one argument. Use .subVectors( a, b ) instead.'
      );
      return this.subVectors(v, w);
    }

    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;

    return this;
  };

  Vector3.prototype.add = function (v, w) {
    if (w !== undefined) {
      console.warn(
        'THREE.Vector3: .add() now only accepts one argument. Use .addVectors( a, b ) instead.'
      );
      return this.addVectors(v, w);
    }

    this.x += v.x;
    this.y += v.y;
    this.z += v.z;

    return this;
  };

  Vector3.prototype.fromArray = function (array, offset) {
    if (offset === undefined) offset = 0;

    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];

    return this;
  };

  // FLAT ARRAY MANAGER BELOW
  // https://codesandbox.io/s/oversized-sab-manager-36rgo

  function addToSBWithOversize(
    atIndex,
    childIndex,
    target,
    oversizeContainer,
    oversizeContainerIndex
  ) {
    const index = atIndex * FIELDS_NO;
    let count = target[index];
    if (count === 0) {
      count++;
      target[index] = count;
      target[index + count] = childIndex;
      return;
    }

    for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
      if (target[index + i + 1] === childIndex) {
        return;
      }
    }

    let oversize = false;
    if (count >= FIELDS_NO - 1) {
      oversize = true;
    }

    if (
      oversize &&
      !addToOversizeContainer(
        oversizeContainer,
        oversizeContainerIndex,
        atIndex,
        childIndex,
        count === FIELDS_NO - 1
      )
    ) {
      return;
    }

    count++;
    target[index] = count;
    if (!oversize) {
      target[index + count] = childIndex;
    }
  }

  function removeFieldFromSBWithOversize(
    indexId,
    elementToRemove,
    sbContainer,
    oversizeContainer,
    oversizeContainerIndex
  ) {
    let index = indexId * FIELDS_NO;
    let count = sbContainer[index];
    let oversize = false;

    if (count === 0) {
      // console.log('Cannot remove from empty element');
      return;
    }
    if (count > FIELDS_NO - 1) {
      oversize = true;
    }
    let found = false;

    if (oversize) {
      const indexOf = oversizedIncludes(
        oversizeContainer,
        oversizeContainerIndex,
        indexId,
        elementToRemove
      );
      if (indexOf !== -1) {
        removeFromOversizeContainer(
          oversizeContainer,
          oversizeContainerIndex,
          indexId,
          elementToRemove
        );
        found = true;
      }
    }

    // if not found in versized find in regular
    if (!found) {
      for (var i = 0; i < count && i < FIELDS_NO - 1; i++) {
        if (!found && sbContainer[index + i + 1] === elementToRemove) {
          found = true;
        }
        if (found) {
          // overwrite and reindexing remaining
          // if it fits in regular non-oversized storage
          if (i <= FIELDS_NO - 3) {
            // maximum allow to copy from field 19 - i + 2
            // so skip this field if i >= FIELDS_NO - 3 (17)
            sbContainer[index + i + 1] = sbContainer[index + i + 2];
          } else if (oversize) {
            // only one elements needs to be popped
            const poppedEl = popOversizedContainer(
              oversizeContainer,
              oversizeContainerIndex,
              indexId
            );
            if (poppedEl !== false) {
              // when this was overwritten by some thread
              sbContainer[index + i + 1] = poppedEl;
            }
          } else {
            // this scenario is only valid on elements with exactly 19 elements
            if (i + 1 !== FIELDS_NO - 1) {
              console.error(
                'this looks like an error. Too many field but no oversize?'
              );
            }
          }
        }
      }
    }

    if (found && count > 0) {
      sbContainer[index] = count - 1;
    }
    return;
  }

  function addToOversizeContainer(
    container,
    containerIndex,
    parentIndex,
    childIndex,
    reset = false
  ) {
    const index = getIndexInOversized(containerIndex, parentIndex);
    if (index === -1 || reset) {
      // console.log('making new oversized for value ', childIndex);
      const newIndex = findFirstFreeZoneInOversizeContainer(container);
      // console.log('new space found', newIndex);
      containerIndex[parentIndex] = newIndex;
      container[newIndex * FIELDS_OVERSIZE] = 1; // new amount of elements at this index (-1 means unused)
      container[newIndex * FIELDS_OVERSIZE + 1] = childIndex;
      return true;
    }

    const childIndexInOversized = oversizedIncludes(
      container,
      containerIndex,
      parentIndex,
      childIndex
    );
    if (childIndexInOversized !== -1) {
      // console.log('already found', parentIndex, childIndex);
      return false;
    } else {
      let length = container[index * FIELDS_OVERSIZE];
      if (length === -1) {
        throw new Error('it should never be -1 here');
      }
      if (length > 100) {
        console.log('high length', length);
      }

      if (length >= FIELDS_OVERSIZE - 1) {
        console.log('END IS HERE!');
        throw new Error('Ran out of oversized container capacity');
      }
      length++;
      container[index * FIELDS_OVERSIZE] = length;
      container[index * FIELDS_OVERSIZE + length] = childIndex;
      // console.log(
      //   'setting at',
      //   index * FIELDS_OVERSIZE + length,
      //   ' value ',
      //   childIndex
      // );
      return true;
    }
  }

  function getIndexInOversized(containerIndex, parentIndex) {
    if (containerIndex[parentIndex] === undefined) {
      throw new Error('Oversize container index is too small ' + parentIndex);
    }
    return containerIndex[parentIndex];
  }

  function findFirstFreeZoneInOversizeContainer(oversizeContainer) {
    for (var i = 0; i < OVERSIZE_CONTAINER_CAPACITY; i++) {
      if (oversizeContainer[i * FIELDS_OVERSIZE] === -1) {
        return i;
      }
    }
    throw new Error('Ran out of space for oversized elements');
  }

  function removeFromOversizeContainer(
    oversizeContainer,
    oversizeContainerIndex,
    parentIndex,
    childIndex
  ) {
    const indexInOversized = getIndexInOversized(
      oversizeContainerIndex,
      parentIndex
    );
    const offset = indexInOversized * FIELDS_OVERSIZE;
    let length = oversizeContainer[offset];
    const childIndexInOversized = oversizedIncludes(
      oversizeContainer,
      oversizeContainerIndex,
      parentIndex,
      childIndex
    );
    if (childIndexInOversized === -1) {
      throw new Error('Element is not present in oversized container');
    }

    // console.log('removing', oversizeContainer[offset + childIndexInOversized]);

    // shift the remaining
    const start = offset + childIndexInOversized;
    const end = offset + length;
    for (var i = start; i < end; i++) {
      oversizeContainer[i] = oversizeContainer[i + 1];
    }
    oversizeContainer[end] = -1;

    length--;
    oversizeContainer[offset] = length; // update length

    // if this is the last element delete the whole thing
    if (length === 0) {
      removeOversizedContainer(
        oversizeContainer,
        oversizeContainerIndex,
        parentIndex
      );
      return;
    }
  }

  function oversizedIncludes(
    container,
    containerIndex,
    parentIndex,
    childIndex
  ) {
    const index = getIndexInOversized(containerIndex, parentIndex);
    const offset = index * FIELDS_OVERSIZE;
    const length = container[offset];
    //     if (length < 1) {
    //       throw new Error('empty value should be -1');
    //     }
    // console.log('checking if includes', parentIndex, childIndex, length);
    for (var i = 0; i <= length; i++) {
      if (container[offset + i] === childIndex) {
        // console.log('found at', index + i);
        return i;
      }
    }
    return -1;
  }

  function removeOversizedContainer(
    oversizeContainer,
    oversizeContainerIndex,
    index
  ) {
    const indexInOversized = oversizeContainerIndex[index];
    const offset = indexInOversized * FIELDS_OVERSIZE;
    const length = oversizeContainer[offset];
    if (length > 0) {
      console.warn('removing non empty oversized container', length);
    }
    oversizeContainer[offset] = -1;
    oversizeContainerIndex[index] = -1;
  }

  function popOversizedContainer(
    oversizeContainer,
    oversizeContainerIndex,
    index
  ) {
    const indexInOversized = getIndexInOversized(oversizeContainerIndex, index);
    const offset = indexInOversized * FIELDS_OVERSIZE;
    let length = oversizeContainer[offset];
    const poppedElement = oversizeContainer[offset + length];

    if (length === 0) {
      // console.warn('thread safe? Cant pop empty element');
      return false;
    }

    oversizeContainer[offset + length] = -1; // clear popped element
    length--;
    oversizeContainer[offset] = length; // update length
    if (length === 0) {
      // if reducing from 1 this is last element
      removeOversizedContainer(
        oversizeContainer,
        oversizeContainerIndex,
        index
      );
    }
    return poppedElement;
  }

  // KEEP THIS LINE
};

//
// build index and unique positions
// it's like indexed geometry but only index and positions attributes
// using non-indexed geometry for other attributes to preserve all the details
//

const getIndexedPositions = (function() {
  let prec = Math.pow(10, 6);
  let vertices = {};
  let id = '';
  let oldVertexIndexByNewIndex = [];

  function store(x, y, z, v, positions) {
    id =
      '_' + Math.floor(x * prec) + Math.floor(y * prec) + Math.floor(z * prec);

    if (!vertices.hasOwnProperty(id)) {
      vertices[id] = oldVertexIndexByNewIndex.length;

      positions.push(x, y, z);
      // access like this
      // positions[vertices[id] * 3] = x;
      // positions[vertices[id] * 3 + 1] = y;
      // positions[vertices[id] * 3 + 2] = z;

      oldVertexIndexByNewIndex.push(v);
    }

    return vertices[id];
  }

  return function buildIndexedPositions(geometry, precision) {
    var SAB = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer;
    const faceCount = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    const largeIndexes = faceCount * 3 > 65536;
    const UIntConstructor = largeIndexes ? Uint32Array : Uint16Array;

    if(geometry.index) {
      const indexSAB = new SAB(geometry.index.array.length * (largeIndexes ? 4 : 2));
      const indexArr = new UIntConstructor(indexSAB);
      indexArr.set(geometry.index.array);
      const posSAB = new SAB(geometry.attributes.position.array.length * 4);
      const posArr = new Float32Array(posSAB);
      posArr.set(geometry.attributes.position.array);
      return {
        index: indexArr,
        positions: posArr,
      };
    }
    prec = Math.pow(10, precision || 4);

    const positionsAttr = [];
    const position = geometry.attributes.position.array;
    const indexBuffer = new SAB(
      faceCount * 3 * (largeIndexes ? 4 : 2)
    );
    const indexArray = new UIntConstructor(indexBuffer);

    for (let i = 0, l = faceCount; i < l; i++) {
      const offset = i * 9;
      indexArray[i * 3] = store(
        position[offset],
        position[offset + 1],
        position[offset + 2],
        i * 3,
        positionsAttr
      );
      indexArray[i * 3 + 1] = store(
        position[offset + 3],
        position[offset + 4],
        position[offset + 5],
        i * 3 + 1,
        positionsAttr
      );
      indexArray[i * 3 + 2] = store(
        position[offset + 6],
        position[offset + 7],
        position[offset + 8],
        i * 3 + 2,
        positionsAttr
      );
    }
    vertices = {};
    oldVertexIndexByNewIndex.length = 0;

    const sab = new SAB(positionsAttr.length * 4);
    const posArr = new Float32Array(sab);
    posArr.set(positionsAttr);

    return {
      index: indexArray,
      positions: posArr
    };
  };
})();

const { AmbientLight, Box3, Color, Group, HemisphereLight, PerspectiveCamera, Scene, SpotLight, WebGLRenderer, Loader, Vector2, Vector3, BufferAttribute, BufferGeometry } = window.dvlpThree || THREE;
const { OrbitControls } = window.dvlpThree || THREE;

class WebWorker {
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
const FIELDS_OVERSIZE$1 = 500;
// if this value is below 10k workers start overlapping each other's work(neighbours can be outside worker's range, there's a locking mechanism for this but not perfect)
const MIN_VERTICES_PER_WORKER = 20000;
// the bigger MIN_VERTICES_PER_WORKER is the bigger OVERSIZE_CONTAINER_CAPACITY should be, 10% size?
const OVERSIZE_CONTAINER_CAPACITY$1 = 2000;
let reqId = 0;

// TODO: wtf is happening with multithreaded optimiser
let totalAvailableWorkers = 1; // Math.min(5, navigator.hardwareConcurrency);
// if SAB is not available use only 1 worker per object to fully contain dataArrays that will be only available after using transferable objects
const isSAB = typeof SharedArrayBuffer !== 'undefined';
const MAX_WORKERS_PER_OBJECT = !isSAB ? 1 : navigator.hardwareConcurrency;
const DISCARD_BELOW_VERTEX_COUNT = 400;

const preloadedWorkers = [];

function createWorkers() {
  for (let i = 0; i < totalAvailableWorkers; i++) {
    preloadedWorkers.push(new WebWorker(simplify_worker));
    preloadedWorkers.forEach((w, index) => {
      w.free = true;
      w.id = index;
    });
  }
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

function meshSimplifier(
  geometry,
  percentage,
  maximumCost = 5,
  modelSize,
  preserveTexture = true,
  attempt = 0,
  resolveTop
) {
  reusingDataArrays = null;
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
  }  return new Promise((resolve, reject) => {
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
  const SAB = isSAB ? SharedArrayBuffer : ArrayBuffer;
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
    new SAB(FIELDS_OVERSIZE$1 * OVERSIZE_CONTAINER_CAPACITY$1 * 4)
  );
  emptyOversizedContainer(specialCases);
  const specialCasesIndex = new Int32Array(new SAB(verexCount * 4));
  emptyOversizedContainerIndex(specialCasesIndex);
  const specialFaceCases = new Int32Array(
    new SAB(FIELDS_OVERSIZE$1 * OVERSIZE_CONTAINER_CAPACITY$1 * 4)
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
    loadBufferGeometry(dataArrays, geometry);
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
      console.error('Optimesh: Bone costs are missing!');

    } else {
      Object.keys(geometry.boneCosts).forEach(boneName => {
        const idx = geometry.skeleton.bones.findIndex(bone => bone.name === boneName);
        if (!idx) return
        boneCosts[idx] = geometry.boneCosts[boneName];
      });
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
    geometry = geometry.toNonIndexed();
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
        FIELDS_OVERSIZE: FIELDS_OVERSIZE$1,
        OVERSIZE_CONTAINER_CAPACITY: OVERSIZE_CONTAINER_CAPACITY$1,
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
          reusingDataArrays = null;
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

  // Critical observation - first culled face starts at index higher than position.count

  for (var i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;
    faceCount++;
  }

  // reindex atlasGroups
  if (geometry.userData.atlasGroups) {
    const atlasGroups = JSON.parse(JSON.stringify(geometry.userData.atlasGroups));
    let totalSkipped = 0;
    atlasGroups.forEach(group => {
      let skippedInGroup = 0;
      for (let i = group.start, l = group.start + group.count; i < l; i += 3) {
        if (faces[i] === -1) {
          skippedInGroup += 3;
        }
      }
      group.start = group.start - totalSkipped;
      group.count = group.count - skippedInGroup;
      totalSkipped += skippedInGroup;
    });
    geo.userData.atlasGroups = atlasGroups;
  }

  // console.log('Faces reduction from : ', faces.length / 3, 'to', faceCount);
  var positions = new Float32Array(faceCount * 9); // faces * 3 vertices * vector3
  var normals = new Float32Array(faceCount * 9);
  var skinWeightArr = new Float32Array(faceCount * 12);
  var skinIndexArr = new Float32Array(faceCount * 12);
  var uvs = new Float32Array(faceCount * 6);

  let count = 0;
  let currentMaterial = null;
  count = 0;

  const index = new Uint32Array(faceCount * 3);

  let currentGroup = null;

  for (i = 0; i < faces.length / 3; i++) {
    if (faces[i * 3] === -1) continue;

    // if (!geometry.index) {
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
      // copyItemFromBufferAttribute(skinWeight, skinWeightArr, 4, i, count);
      // copyItemFromBufferAttribute(skinIndex, skinIndexArr, 4, i, count);
      copyItemFromBufferAttribute(uvsView, uvs, 2, i, count);
    // }

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

  const vertexLength = count * 3;

  const setAttribute = geo.setAttribute ? geo.setAttribute : geo.addAttribute;

  // if (!geometry.index) {
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
  // }

  console.log(
    'Result mesh ' + geometry.name + ' sizes:',
    'vertices',
    vertexLength,
    'normals',
    normals.length,
    'uv',
    uvs.length
  );
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

/**
 * Bundled by jsDelivr using Rollup v2.79.1 and Terser v5.19.2.
 * Original file: /npm/dat.gui@0.7.9/build/dat.gui.module.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
function e(e,t){var n=e.__state.conversionName.toString(),o=Math.round(e.r),i=Math.round(e.g),r=Math.round(e.b),s=e.a,a=Math.round(e.h),l=e.s.toFixed(1),d=e.v.toFixed(1);if(t||"THREE_CHAR_HEX"===n||"SIX_CHAR_HEX"===n){for(var c=e.hex.toString(16);c.length<6;)c="0"+c;return "#"+c}return "CSS_RGB"===n?"rgb("+o+","+i+","+r+")":"CSS_RGBA"===n?"rgba("+o+","+i+","+r+","+s+")":"HEX"===n?"0x"+e.hex.toString(16):"RGB_ARRAY"===n?"["+o+","+i+","+r+"]":"RGBA_ARRAY"===n?"["+o+","+i+","+r+","+s+"]":"RGB_OBJ"===n?"{r:"+o+",g:"+i+",b:"+r+"}":"RGBA_OBJ"===n?"{r:"+o+",g:"+i+",b:"+r+",a:"+s+"}":"HSV_OBJ"===n?"{h:"+a+",s:"+l+",v:"+d+"}":"HSVA_OBJ"===n?"{h:"+a+",s:"+l+",v:"+d+",a:"+s+"}":"unknown format"}var t=Array.prototype.forEach,n=Array.prototype.slice,o={BREAK:{},extend:function(e){return this.each(n.call(arguments,1),(function(t){(this.isObject(t)?Object.keys(t):[]).forEach(function(n){this.isUndefined(t[n])||(e[n]=t[n]);}.bind(this));}),this),e},defaults:function(e){return this.each(n.call(arguments,1),(function(t){(this.isObject(t)?Object.keys(t):[]).forEach(function(n){this.isUndefined(e[n])&&(e[n]=t[n]);}.bind(this));}),this),e},compose:function(){var e=n.call(arguments);return function(){for(var t=n.call(arguments),o=e.length-1;o>=0;o--)t=[e[o].apply(this,t)];return t[0]}},each:function(e,n,o){if(e)if(t&&e.forEach&&e.forEach===t)e.forEach(n,o);else if(e.length===e.length+0){var i,r=void 0;for(r=0,i=e.length;r<i;r++)if(r in e&&n.call(o,e[r],r)===this.BREAK)return}else for(var s in e)if(n.call(o,e[s],s)===this.BREAK)return},defer:function(e){setTimeout(e,0);},debounce:function(e,t,n){var o=void 0;return function(){var i=this,r=arguments;var s=n||!o;clearTimeout(o),o=setTimeout((function(){o=null,n||e.apply(i,r);}),t),s&&e.apply(i,r);}},toArray:function(e){return e.toArray?e.toArray():n.call(e)},isUndefined:function(e){return void 0===e},isNull:function(e){return null===e},isNaN:function(e){function t(t){return e.apply(this,arguments)}return t.toString=function(){return e.toString()},t}((function(e){return isNaN(e)})),isArray:Array.isArray||function(e){return e.constructor===Array},isObject:function(e){return e===Object(e)},isNumber:function(e){return e===e+0},isString:function(e){return e===e+""},isBoolean:function(e){return !1===e||!0===e},isFunction:function(e){return e instanceof Function}},i=[{litmus:o.isString,conversions:{THREE_CHAR_HEX:{read:function(e){var t=e.match(/^#([A-F0-9])([A-F0-9])([A-F0-9])$/i);return null!==t&&{space:"HEX",hex:parseInt("0x"+t[1].toString()+t[1].toString()+t[2].toString()+t[2].toString()+t[3].toString()+t[3].toString(),0)}},write:e},SIX_CHAR_HEX:{read:function(e){var t=e.match(/^#([A-F0-9]{6})$/i);return null!==t&&{space:"HEX",hex:parseInt("0x"+t[1].toString(),0)}},write:e},CSS_RGB:{read:function(e){var t=e.match(/^rgb\(\s*(\S+)\s*,\s*(\S+)\s*,\s*(\S+)\s*\)/);return null!==t&&{space:"RGB",r:parseFloat(t[1]),g:parseFloat(t[2]),b:parseFloat(t[3])}},write:e},CSS_RGBA:{read:function(e){var t=e.match(/^rgba\(\s*(\S+)\s*,\s*(\S+)\s*,\s*(\S+)\s*,\s*(\S+)\s*\)/);return null!==t&&{space:"RGB",r:parseFloat(t[1]),g:parseFloat(t[2]),b:parseFloat(t[3]),a:parseFloat(t[4])}},write:e}}},{litmus:o.isNumber,conversions:{HEX:{read:function(e){return {space:"HEX",hex:e,conversionName:"HEX"}},write:function(e){return e.hex}}}},{litmus:o.isArray,conversions:{RGB_ARRAY:{read:function(e){return 3===e.length&&{space:"RGB",r:e[0],g:e[1],b:e[2]}},write:function(e){return [e.r,e.g,e.b]}},RGBA_ARRAY:{read:function(e){return 4===e.length&&{space:"RGB",r:e[0],g:e[1],b:e[2],a:e[3]}},write:function(e){return [e.r,e.g,e.b,e.a]}}}},{litmus:o.isObject,conversions:{RGBA_OBJ:{read:function(e){return !!(o.isNumber(e.r)&&o.isNumber(e.g)&&o.isNumber(e.b)&&o.isNumber(e.a))&&{space:"RGB",r:e.r,g:e.g,b:e.b,a:e.a}},write:function(e){return {r:e.r,g:e.g,b:e.b,a:e.a}}},RGB_OBJ:{read:function(e){return !!(o.isNumber(e.r)&&o.isNumber(e.g)&&o.isNumber(e.b))&&{space:"RGB",r:e.r,g:e.g,b:e.b}},write:function(e){return {r:e.r,g:e.g,b:e.b}}},HSVA_OBJ:{read:function(e){return !!(o.isNumber(e.h)&&o.isNumber(e.s)&&o.isNumber(e.v)&&o.isNumber(e.a))&&{space:"HSV",h:e.h,s:e.s,v:e.v,a:e.a}},write:function(e){return {h:e.h,s:e.s,v:e.v,a:e.a}}},HSV_OBJ:{read:function(e){return !!(o.isNumber(e.h)&&o.isNumber(e.s)&&o.isNumber(e.v))&&{space:"HSV",h:e.h,s:e.s,v:e.v}},write:function(e){return {h:e.h,s:e.s,v:e.v}}}}}],r=void 0,s=void 0,a=function(){s=!1;var e=arguments.length>1?o.toArray(arguments):arguments[0];return o.each(i,(function(t){if(t.litmus(e))return o.each(t.conversions,(function(t,n){if(r=t.read(e),!1===s&&!1!==r)return s=r,r.conversionName=n,r.conversion=t,o.BREAK})),o.BREAK})),s},l=void 0,d={hsv_to_rgb:function(e,t,n){var o=Math.floor(e/60)%6,i=e/60-Math.floor(e/60),r=n*(1-t),s=n*(1-i*t),a=n*(1-(1-i)*t),l=[[n,a,r],[s,n,r],[r,n,a],[r,s,n],[a,r,n],[n,r,s]][o];return {r:255*l[0],g:255*l[1],b:255*l[2]}},rgb_to_hsv:function(e,t,n){var o=Math.min(e,t,n),i=Math.max(e,t,n),r=i-o,s=void 0;return 0===i?{h:NaN,s:0,v:0}:(s=e===i?(t-n)/r:t===i?2+(n-e)/r:4+(e-t)/r,(s/=6)<0&&(s+=1),{h:360*s,s:r/i,v:i/255})},rgb_to_hex:function(e,t,n){var o=this.hex_with_component(0,2,e);return o=this.hex_with_component(o,1,t),o=this.hex_with_component(o,0,n)},component_from_hex:function(e,t){return e>>8*t&255},hex_with_component:function(e,t,n){return n<<(l=8*t)|e&~(255<<l)}},c="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},u=function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")},_=function(){function e(e,t){for(var n=0;n<t.length;n++){var o=t[n];o.enumerable=o.enumerable||!1,o.configurable=!0,"value"in o&&(o.writable=!0),Object.defineProperty(e,o.key,o);}}return function(t,n,o){return n&&e(t.prototype,n),o&&e(t,o),t}}(),h=function e(t,n,o){null===t&&(t=Function.prototype);var i=Object.getOwnPropertyDescriptor(t,n);if(void 0===i){var r=Object.getPrototypeOf(t);return null===r?void 0:e(r,n,o)}if("value"in i)return i.value;var s=i.get;return void 0!==s?s.call(o):void 0},p=function(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function, not "+typeof t);e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}}),t&&(Object.setPrototypeOf?Object.setPrototypeOf(e,t):e.__proto__=t);},f=function(e,t){if(!e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return !t||"object"!=typeof t&&"function"!=typeof t?e:t},m=function(){function t(){if(u(this,t),this.__state=a.apply(this,arguments),!1===this.__state)throw new Error("Failed to interpret color arguments");this.__state.a=this.__state.a||1;}return _(t,[{key:"toString",value:function(){return e(this)}},{key:"toHexString",value:function(){return e(this,!0)}},{key:"toOriginal",value:function(){return this.__state.conversion.write(this)}}]),t}();function g(e,t,n){Object.defineProperty(e,t,{get:function(){return "RGB"===this.__state.space||m.recalculateRGB(this,t,n),this.__state[t]},set:function(e){"RGB"!==this.__state.space&&(m.recalculateRGB(this,t,n),this.__state.space="RGB"),this.__state[t]=e;}});}function b(e,t){Object.defineProperty(e,t,{get:function(){return "HSV"===this.__state.space||m.recalculateHSV(this),this.__state[t]},set:function(e){"HSV"!==this.__state.space&&(m.recalculateHSV(this),this.__state.space="HSV"),this.__state[t]=e;}});}m.recalculateRGB=function(e,t,n){if("HEX"===e.__state.space)e.__state[t]=d.component_from_hex(e.__state.hex,n);else {if("HSV"!==e.__state.space)throw new Error("Corrupted color state");o.extend(e.__state,d.hsv_to_rgb(e.__state.h,e.__state.s,e.__state.v));}},m.recalculateHSV=function(e){var t=d.rgb_to_hsv(e.r,e.g,e.b);o.extend(e.__state,{s:t.s,v:t.v}),o.isNaN(t.h)?o.isUndefined(e.__state.h)&&(e.__state.h=0):e.__state.h=t.h;},m.COMPONENTS=["r","g","b","h","s","v","hex","a"],g(m.prototype,"r",2),g(m.prototype,"g",1),g(m.prototype,"b",0),b(m.prototype,"h"),b(m.prototype,"s"),b(m.prototype,"v"),Object.defineProperty(m.prototype,"a",{get:function(){return this.__state.a},set:function(e){this.__state.a=e;}}),Object.defineProperty(m.prototype,"hex",{get:function(){return "HEX"!==this.__state.space&&(this.__state.hex=d.rgb_to_hex(this.r,this.g,this.b),this.__state.space="HEX"),this.__state.hex},set:function(e){this.__state.space="HEX",this.__state.hex=e;}});var v=function(){function e(t,n){u(this,e),this.initialValue=t[n],this.domElement=document.createElement("div"),this.object=t,this.property=n,this.__onChange=void 0,this.__onFinishChange=void 0;}return _(e,[{key:"onChange",value:function(e){return this.__onChange=e,this}},{key:"onFinishChange",value:function(e){return this.__onFinishChange=e,this}},{key:"setValue",value:function(e){return this.object[this.property]=e,this.__onChange&&this.__onChange.call(this,e),this.updateDisplay(),this}},{key:"getValue",value:function(){return this.object[this.property]}},{key:"updateDisplay",value:function(){return this}},{key:"isModified",value:function(){return this.initialValue!==this.getValue()}}]),e}(),y={};o.each({HTMLEvents:["change"],MouseEvents:["click","mousemove","mousedown","mouseup","mouseover"],KeyboardEvents:["keydown"]},(function(e,t){o.each(e,(function(e){y[e]=t;}));}));var w=/(\d+(\.\d+)?)px/;function x(e){if("0"===e||o.isUndefined(e))return 0;var t=e.match(w);return o.isNull(t)?0:parseFloat(t[1])}var E={makeSelectable:function(e,t){void 0!==e&&void 0!==e.style&&(e.onselectstart=t?function(){return !1}:function(){},e.style.MozUserSelect=t?"auto":"none",e.style.KhtmlUserSelect=t?"auto":"none",e.unselectable=t?"on":"off");},makeFullscreen:function(e,t,n){var i=n,r=t;o.isUndefined(r)&&(r=!0),o.isUndefined(i)&&(i=!0),e.style.position="absolute",r&&(e.style.left=0,e.style.right=0),i&&(e.style.top=0,e.style.bottom=0);},fakeEvent:function(e,t,n,i){var r=n||{},s=y[t];if(!s)throw new Error("Event type "+t+" not supported.");var a=document.createEvent(s);switch(s){case"MouseEvents":var l=r.x||r.clientX||0,d=r.y||r.clientY||0;a.initMouseEvent(t,r.bubbles||!1,r.cancelable||!0,window,r.clickCount||1,0,0,l,d,!1,!1,!1,!1,0,null);break;case"KeyboardEvents":var c=a.initKeyboardEvent||a.initKeyEvent;o.defaults(r,{cancelable:!0,ctrlKey:!1,altKey:!1,shiftKey:!1,metaKey:!1,keyCode:void 0,charCode:void 0}),c(t,r.bubbles||!1,r.cancelable,window,r.ctrlKey,r.altKey,r.shiftKey,r.metaKey,r.keyCode,r.charCode);break;default:a.initEvent(t,r.bubbles||!1,r.cancelable||!0);}o.defaults(a,i),e.dispatchEvent(a);},bind:function(e,t,n,o){var i=o||!1;return e.addEventListener?e.addEventListener(t,n,i):e.attachEvent&&e.attachEvent("on"+t,n),E},unbind:function(e,t,n,o){var i=o||!1;return e.removeEventListener?e.removeEventListener(t,n,i):e.detachEvent&&e.detachEvent("on"+t,n),E},addClass:function(e,t){if(void 0===e.className)e.className=t;else if(e.className!==t){var n=e.className.split(/ +/);-1===n.indexOf(t)&&(n.push(t),e.className=n.join(" ").replace(/^\s+/,"").replace(/\s+$/,""));}return E},removeClass:function(e,t){if(t)if(e.className===t)e.removeAttribute("class");else {var n=e.className.split(/ +/),o=n.indexOf(t);-1!==o&&(n.splice(o,1),e.className=n.join(" "));}else e.className=void 0;return E},hasClass:function(e,t){return new RegExp("(?:^|\\s+)"+t+"(?:\\s+|$)").test(e.className)||!1},getWidth:function(e){var t=getComputedStyle(e);return x(t["border-left-width"])+x(t["border-right-width"])+x(t["padding-left"])+x(t["padding-right"])+x(t.width)},getHeight:function(e){var t=getComputedStyle(e);return x(t["border-top-width"])+x(t["border-bottom-width"])+x(t["padding-top"])+x(t["padding-bottom"])+x(t.height)},getOffset:function(e){var t=e,n={left:0,top:0};if(t.offsetParent)do{n.left+=t.offsetLeft,n.top+=t.offsetTop,t=t.offsetParent;}while(t);return n},isActive:function(e){return e===document.activeElement&&(e.type||e.href)}},C=function(e){function t(e,n){u(this,t);var o=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n)),i=o;return o.__prev=o.getValue(),o.__checkbox=document.createElement("input"),o.__checkbox.setAttribute("type","checkbox"),E.bind(o.__checkbox,"change",(function(){i.setValue(!i.__prev);}),!1),o.domElement.appendChild(o.__checkbox),o.updateDisplay(),o}return p(t,v),_(t,[{key:"setValue",value:function(e){var n=h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"setValue",this).call(this,e);return this.__onFinishChange&&this.__onFinishChange.call(this,this.getValue()),this.__prev=this.getValue(),n}},{key:"updateDisplay",value:function(){return !0===this.getValue()?(this.__checkbox.setAttribute("checked","checked"),this.__checkbox.checked=!0,this.__prev=!0):(this.__checkbox.checked=!1,this.__prev=!1),h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"updateDisplay",this).call(this)}}]),t}(),A=function(e){function t(e,n,i){u(this,t);var r=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n)),s=i,a=r;if(r.__select=document.createElement("select"),o.isArray(s)){var l={};o.each(s,(function(e){l[e]=e;})),s=l;}return o.each(s,(function(e,t){var n=document.createElement("option");n.innerHTML=t,n.setAttribute("value",e),a.__select.appendChild(n);})),r.updateDisplay(),E.bind(r.__select,"change",(function(){var e=this.options[this.selectedIndex].value;a.setValue(e);})),r.domElement.appendChild(r.__select),r}return p(t,v),_(t,[{key:"setValue",value:function(e){var n=h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"setValue",this).call(this,e);return this.__onFinishChange&&this.__onFinishChange.call(this,this.getValue()),n}},{key:"updateDisplay",value:function(){return E.isActive(this.__select)?this:(this.__select.value=this.getValue(),h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"updateDisplay",this).call(this))}}]),t}(),k=function(e){function t(e,n){u(this,t);var o=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n)),i=o;function r(){i.setValue(i.__input.value);}return o.__input=document.createElement("input"),o.__input.setAttribute("type","text"),E.bind(o.__input,"keyup",r),E.bind(o.__input,"change",r),E.bind(o.__input,"blur",(function(){i.__onFinishChange&&i.__onFinishChange.call(i,i.getValue());})),E.bind(o.__input,"keydown",(function(e){13===e.keyCode&&this.blur();})),o.updateDisplay(),o.domElement.appendChild(o.__input),o}return p(t,v),_(t,[{key:"updateDisplay",value:function(){return E.isActive(this.__input)||(this.__input.value=this.getValue()),h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"updateDisplay",this).call(this)}}]),t}();function S(e){var t=e.toString();return t.indexOf(".")>-1?t.length-t.indexOf(".")-1:0}var O=function(e){function t(e,n,i){u(this,t);var r=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n)),s=i||{};return r.__min=s.min,r.__max=s.max,r.__step=s.step,o.isUndefined(r.__step)?0===r.initialValue?r.__impliedStep=1:r.__impliedStep=Math.pow(10,Math.floor(Math.log(Math.abs(r.initialValue))/Math.LN10))/10:r.__impliedStep=r.__step,r.__precision=S(r.__impliedStep),r}return p(t,v),_(t,[{key:"setValue",value:function(e){var n=e;return void 0!==this.__min&&n<this.__min?n=this.__min:void 0!==this.__max&&n>this.__max&&(n=this.__max),void 0!==this.__step&&n%this.__step!=0&&(n=Math.round(n/this.__step)*this.__step),h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"setValue",this).call(this,n)}},{key:"min",value:function(e){return this.__min=e,this}},{key:"max",value:function(e){return this.__max=e,this}},{key:"step",value:function(e){return this.__step=e,this.__impliedStep=e,this.__precision=S(e),this}}]),t}();var T=function(e){function t(e,n,i){u(this,t);var r=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n,i));r.__truncationSuspended=!1;var s=r,a=void 0;function l(){s.__onFinishChange&&s.__onFinishChange.call(s,s.getValue());}function d(e){var t=a-e.clientY;s.setValue(s.getValue()+t*s.__impliedStep),a=e.clientY;}function c(){E.unbind(window,"mousemove",d),E.unbind(window,"mouseup",c),l();}return r.__input=document.createElement("input"),r.__input.setAttribute("type","text"),E.bind(r.__input,"change",(function(){var e=parseFloat(s.__input.value);o.isNaN(e)||s.setValue(e);})),E.bind(r.__input,"blur",(function(){l();})),E.bind(r.__input,"mousedown",(function(e){E.bind(window,"mousemove",d),E.bind(window,"mouseup",c),a=e.clientY;})),E.bind(r.__input,"keydown",(function(e){13===e.keyCode&&(s.__truncationSuspended=!0,this.blur(),s.__truncationSuspended=!1,l());})),r.updateDisplay(),r.domElement.appendChild(r.__input),r}return p(t,O),_(t,[{key:"updateDisplay",value:function(){var e,n,o;return this.__input.value=this.__truncationSuspended?this.getValue():(e=this.getValue(),n=this.__precision,o=Math.pow(10,n),Math.round(e*o)/o),h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"updateDisplay",this).call(this)}}]),t}();function L(e,t,n,o,i){return o+(e-t)/(n-t)*(i-o)}var R=function(e){function t(e,n,o,i,r){u(this,t);var s=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n,{min:o,max:i,step:r})),a=s;function l(e){e.preventDefault();var t=a.__background.getBoundingClientRect();return a.setValue(L(e.clientX,t.left,t.right,a.__min,a.__max)),!1}function d(){E.unbind(window,"mousemove",l),E.unbind(window,"mouseup",d),a.__onFinishChange&&a.__onFinishChange.call(a,a.getValue());}function c(e){var t=e.touches[0].clientX,n=a.__background.getBoundingClientRect();a.setValue(L(t,n.left,n.right,a.__min,a.__max));}function _(){E.unbind(window,"touchmove",c),E.unbind(window,"touchend",_),a.__onFinishChange&&a.__onFinishChange.call(a,a.getValue());}return s.__background=document.createElement("div"),s.__foreground=document.createElement("div"),E.bind(s.__background,"mousedown",(function(e){document.activeElement.blur(),E.bind(window,"mousemove",l),E.bind(window,"mouseup",d),l(e);})),E.bind(s.__background,"touchstart",(function(e){if(1!==e.touches.length)return;E.bind(window,"touchmove",c),E.bind(window,"touchend",_),c(e);})),E.addClass(s.__background,"slider"),E.addClass(s.__foreground,"slider-fg"),s.updateDisplay(),s.__background.appendChild(s.__foreground),s.domElement.appendChild(s.__background),s}return p(t,O),_(t,[{key:"updateDisplay",value:function(){var e=(this.getValue()-this.__min)/(this.__max-this.__min);return this.__foreground.style.width=100*e+"%",h(t.prototype.__proto__||Object.getPrototypeOf(t.prototype),"updateDisplay",this).call(this)}}]),t}(),B=function(e){function t(e,n,o){u(this,t);var i=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n)),r=i;return i.__button=document.createElement("div"),i.__button.innerHTML=void 0===o?"Fire":o,E.bind(i.__button,"click",(function(e){return e.preventDefault(),r.fire(),!1})),E.addClass(i.__button,"button"),i.domElement.appendChild(i.__button),i}return p(t,v),_(t,[{key:"fire",value:function(){this.__onChange&&this.__onChange.call(this),this.getValue().call(this.object),this.__onFinishChange&&this.__onFinishChange.call(this,this.getValue());}}]),t}(),N=function(e){function t(e,n){u(this,t);var i=f(this,(t.__proto__||Object.getPrototypeOf(t)).call(this,e,n));i.__color=new m(i.getValue()),i.__temp=new m(0);var r=i;i.domElement=document.createElement("div"),E.makeSelectable(i.domElement,!1),i.__selector=document.createElement("div"),i.__selector.className="selector",i.__saturation_field=document.createElement("div"),i.__saturation_field.className="saturation-field",i.__field_knob=document.createElement("div"),i.__field_knob.className="field-knob",i.__field_knob_border="2px solid ",i.__hue_knob=document.createElement("div"),i.__hue_knob.className="hue-knob",i.__hue_field=document.createElement("div"),i.__hue_field.className="hue-field",i.__input=document.createElement("input"),i.__input.type="text",i.__input_textShadow="0 1px 1px ",E.bind(i.__input,"keydown",(function(e){13===e.keyCode&&p.call(this);})),E.bind(i.__input,"blur",p),E.bind(i.__selector,"mousedown",(function(){E.addClass(this,"drag").bind(window,"mouseup",(function(){E.removeClass(r.__selector,"drag");}));})),E.bind(i.__selector,"touchstart",(function(){E.addClass(this,"drag").bind(window,"touchend",(function(){E.removeClass(r.__selector,"drag");}));}));var s,l=document.createElement("div");function d(e){b(e),E.bind(window,"mousemove",b),E.bind(window,"touchmove",b),E.bind(window,"mouseup",_),E.bind(window,"touchend",_);}function c(e){v(e),E.bind(window,"mousemove",v),E.bind(window,"touchmove",v),E.bind(window,"mouseup",h),E.bind(window,"touchend",h);}function _(){E.unbind(window,"mousemove",b),E.unbind(window,"touchmove",b),E.unbind(window,"mouseup",_),E.unbind(window,"touchend",_),g();}function h(){E.unbind(window,"mousemove",v),E.unbind(window,"touchmove",v),E.unbind(window,"mouseup",h),E.unbind(window,"touchend",h),g();}function p(){var e=a(this.value);!1!==e?(r.__color.__state=e,r.setValue(r.__color.toOriginal())):this.value=r.__color.toString();}function g(){r.__onFinishChange&&r.__onFinishChange.call(r,r.__color.toOriginal());}function b(e){-1===e.type.indexOf("touch")&&e.preventDefault();var t=r.__saturation_field.getBoundingClientRect(),n=e.touches&&e.touches[0]||e,o=n.clientX,i=n.clientY,s=(o-t.left)/(t.right-t.left),a=1-(i-t.top)/(t.bottom-t.top);return a>1?a=1:a<0&&(a=0),s>1?s=1:s<0&&(s=0),r.__color.v=a,r.__color.s=s,r.setValue(r.__color.toOriginal()),!1}function v(e){-1===e.type.indexOf("touch")&&e.preventDefault();var t=r.__hue_field.getBoundingClientRect(),n=1-((e.touches&&e.touches[0]||e).clientY-t.top)/(t.bottom-t.top);return n>1?n=1:n<0&&(n=0),r.__color.h=360*n,r.setValue(r.__color.toOriginal()),!1}return o.extend(i.__selector.style,{width:"122px",height:"102px",padding:"3px",backgroundColor:"#222",boxShadow:"0px 1px 3px rgba(0,0,0,0.3)"}),o.extend(i.__field_knob.style,{position:"absolute",width:"12px",height:"12px",border:i.__field_knob_border+(i.__color.v<.5?"#fff":"#000"),boxShadow:"0px 1px 3px rgba(0,0,0,0.5)",borderRadius:"12px",zIndex:1}),o.extend(i.__hue_knob.style,{position:"absolute",width:"15px",height:"2px",borderRight:"4px solid #fff",zIndex:1}),o.extend(i.__saturation_field.style,{width:"100px",height:"100px",border:"1px solid #555",marginRight:"3px",display:"inline-block",cursor:"pointer"}),o.extend(l.style,{width:"100%",height:"100%",background:"none"}),F(l,"top","rgba(0,0,0,0)","#000"),o.extend(i.__hue_field.style,{width:"15px",height:"100px",border:"1px solid #555",cursor:"ns-resize",position:"absolute",top:"3px",right:"3px"}),(s=i.__hue_field).style.background="",s.style.cssText+="background: -moz-linear-gradient(top,  #ff0000 0%, #ff00ff 17%, #0000ff 34%, #00ffff 50%, #00ff00 67%, #ffff00 84%, #ff0000 100%);",s.style.cssText+="background: -webkit-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);",s.style.cssText+="background: -o-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);",s.style.cssText+="background: -ms-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);",s.style.cssText+="background: linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);",o.extend(i.__input.style,{outline:"none",textAlign:"center",color:"#fff",border:0,fontWeight:"bold",textShadow:i.__input_textShadow+"rgba(0,0,0,0.7)"}),E.bind(i.__saturation_field,"mousedown",d),E.bind(i.__saturation_field,"touchstart",d),E.bind(i.__field_knob,"mousedown",d),E.bind(i.__field_knob,"touchstart",d),E.bind(i.__hue_field,"mousedown",c),E.bind(i.__hue_field,"touchstart",c),i.__saturation_field.appendChild(l),i.__selector.appendChild(i.__field_knob),i.__selector.appendChild(i.__saturation_field),i.__selector.appendChild(i.__hue_field),i.__hue_field.appendChild(i.__hue_knob),i.domElement.appendChild(i.__input),i.domElement.appendChild(i.__selector),i.updateDisplay(),i}return p(t,v),_(t,[{key:"updateDisplay",value:function(){var e=a(this.getValue());if(!1!==e){var t=!1;o.each(m.COMPONENTS,(function(n){if(!o.isUndefined(e[n])&&!o.isUndefined(this.__color.__state[n])&&e[n]!==this.__color.__state[n])return t=!0,{}}),this),t&&o.extend(this.__color.__state,e);}o.extend(this.__temp.__state,this.__color.__state),this.__temp.a=1;var n=this.__color.v<.5||this.__color.s>.5?255:0,i=255-n;o.extend(this.__field_knob.style,{marginLeft:100*this.__color.s-7+"px",marginTop:100*(1-this.__color.v)-7+"px",backgroundColor:this.__temp.toHexString(),border:this.__field_knob_border+"rgb("+n+","+n+","+n+")"}),this.__hue_knob.style.marginTop=100*(1-this.__color.h/360)+"px",this.__temp.s=1,this.__temp.v=1,F(this.__saturation_field,"left","#fff",this.__temp.toHexString()),this.__input.value=this.__color.toString(),o.extend(this.__input.style,{backgroundColor:this.__color.toHexString(),color:"rgb("+n+","+n+","+n+")",textShadow:this.__input_textShadow+"rgba("+i+","+i+","+i+",.7)"});}}]),t}(),H=["-moz-","-o-","-webkit-","-ms-",""];function F(e,t,n,i){e.style.background="",o.each(H,(function(o){e.style.cssText+="background: "+o+"linear-gradient("+t+", "+n+" 0%, "+i+" 100%); ";}));}var P=function(e,t){var n=t||document,o=document.createElement("style");o.type="text/css",o.innerHTML=e;var i=n.getElementsByTagName("head")[0];try{i.appendChild(o);}catch(e){}},D=function(e,t){var n=e[t];return o.isArray(arguments[2])||o.isObject(arguments[2])?new A(e,t,arguments[2]):o.isNumber(n)?o.isNumber(arguments[2])&&o.isNumber(arguments[3])?o.isNumber(arguments[4])?new R(e,t,arguments[2],arguments[3],arguments[4]):new R(e,t,arguments[2],arguments[3]):o.isNumber(arguments[4])?new T(e,t,{min:arguments[2],max:arguments[3],step:arguments[4]}):new T(e,t,{min:arguments[2],max:arguments[3]}):o.isString(n)?new k(e,t):o.isFunction(n)?new B(e,t,""):o.isBoolean(n)?new C(e,t):null};var V=window.requestAnimationFrame||window.webkitRequestAnimationFrame||window.mozRequestAnimationFrame||window.oRequestAnimationFrame||window.msRequestAnimationFrame||function(e){setTimeout(e,1e3/60);},j=function(){function e(){u(this,e),this.backgroundElement=document.createElement("div"),o.extend(this.backgroundElement.style,{backgroundColor:"rgba(0,0,0,0.8)",top:0,left:0,display:"none",zIndex:"1000",opacity:0,WebkitTransition:"opacity 0.2s linear",transition:"opacity 0.2s linear"}),E.makeFullscreen(this.backgroundElement),this.backgroundElement.style.position="fixed",this.domElement=document.createElement("div"),o.extend(this.domElement.style,{position:"fixed",display:"none",zIndex:"1001",opacity:0,WebkitTransition:"-webkit-transform 0.2s ease-out, opacity 0.2s linear",transition:"transform 0.2s ease-out, opacity 0.2s linear"}),document.body.appendChild(this.backgroundElement),document.body.appendChild(this.domElement);var t=this;E.bind(this.backgroundElement,"click",(function(){t.hide();}));}return _(e,[{key:"show",value:function(){var e=this;this.backgroundElement.style.display="block",this.domElement.style.display="block",this.domElement.style.opacity=0,this.domElement.style.webkitTransform="scale(1.1)",this.layout(),o.defer((function(){e.backgroundElement.style.opacity=1,e.domElement.style.opacity=1,e.domElement.style.webkitTransform="scale(1)";}));}},{key:"hide",value:function(){var e=this,t=function t(){e.domElement.style.display="none",e.backgroundElement.style.display="none",E.unbind(e.domElement,"webkitTransitionEnd",t),E.unbind(e.domElement,"transitionend",t),E.unbind(e.domElement,"oTransitionEnd",t);};E.bind(this.domElement,"webkitTransitionEnd",t),E.bind(this.domElement,"transitionend",t),E.bind(this.domElement,"oTransitionEnd",t),this.backgroundElement.style.opacity=0,this.domElement.style.opacity=0,this.domElement.style.webkitTransform="scale(1.1)";}},{key:"layout",value:function(){this.domElement.style.left=window.innerWidth/2-E.getWidth(this.domElement)/2+"px",this.domElement.style.top=window.innerHeight/2-E.getHeight(this.domElement)/2+"px";}}]),e}(),I=function(e){if(e&&"undefined"!=typeof window){var t=document.createElement("style");return t.setAttribute("type","text/css"),t.innerHTML=e,document.head.appendChild(t),e}}(".dg ul{list-style:none;margin:0;padding:0;width:100%;clear:both}.dg.ac{position:fixed;top:0;left:0;right:0;height:0;z-index:0}.dg:not(.ac) .main{overflow:hidden}.dg.main{-webkit-transition:opacity .1s linear;-o-transition:opacity .1s linear;-moz-transition:opacity .1s linear;transition:opacity .1s linear}.dg.main.taller-than-window{overflow-y:auto}.dg.main.taller-than-window .close-button{opacity:1;margin-top:-1px;border-top:1px solid #2c2c2c}.dg.main ul.closed .close-button{opacity:1 !important}.dg.main:hover .close-button,.dg.main .close-button.drag{opacity:1}.dg.main .close-button{-webkit-transition:opacity .1s linear;-o-transition:opacity .1s linear;-moz-transition:opacity .1s linear;transition:opacity .1s linear;border:0;line-height:19px;height:20px;cursor:pointer;text-align:center;background-color:#000}.dg.main .close-button.close-top{position:relative}.dg.main .close-button.close-bottom{position:absolute}.dg.main .close-button:hover{background-color:#111}.dg.a{float:right;margin-right:15px;overflow-y:visible}.dg.a.has-save>ul.close-top{margin-top:0}.dg.a.has-save>ul.close-bottom{margin-top:27px}.dg.a.has-save>ul.closed{margin-top:0}.dg.a .save-row{top:0;z-index:1002}.dg.a .save-row.close-top{position:relative}.dg.a .save-row.close-bottom{position:fixed}.dg li{-webkit-transition:height .1s ease-out;-o-transition:height .1s ease-out;-moz-transition:height .1s ease-out;transition:height .1s ease-out;-webkit-transition:overflow .1s linear;-o-transition:overflow .1s linear;-moz-transition:overflow .1s linear;transition:overflow .1s linear}.dg li:not(.folder){cursor:auto;height:27px;line-height:27px;padding:0 4px 0 5px}.dg li.folder{padding:0;border-left:4px solid rgba(0,0,0,0)}.dg li.title{cursor:pointer;margin-left:-4px}.dg .closed li:not(.title),.dg .closed ul li,.dg .closed ul li>*{height:0;overflow:hidden;border:0}.dg .cr{clear:both;padding-left:3px;height:27px;overflow:hidden}.dg .property-name{cursor:default;float:left;clear:left;width:40%;overflow:hidden;text-overflow:ellipsis}.dg .cr.function .property-name{width:100%}.dg .c{float:left;width:60%;position:relative}.dg .c input[type=text]{border:0;margin-top:4px;padding:3px;width:100%;float:right}.dg .has-slider input[type=text]{width:30%;margin-left:0}.dg .slider{float:left;width:66%;margin-left:-5px;margin-right:0;height:19px;margin-top:4px}.dg .slider-fg{height:100%}.dg .c input[type=checkbox]{margin-top:7px}.dg .c select{margin-top:5px}.dg .cr.function,.dg .cr.function .property-name,.dg .cr.function *,.dg .cr.boolean,.dg .cr.boolean *{cursor:pointer}.dg .cr.color{overflow:visible}.dg .selector{display:none;position:absolute;margin-left:-9px;margin-top:23px;z-index:10}.dg .c:hover .selector,.dg .selector.drag{display:block}.dg li.save-row{padding:0}.dg li.save-row .button{display:inline-block;padding:0px 6px}.dg.dialogue{background-color:#222;width:460px;padding:15px;font-size:13px;line-height:15px}#dg-new-constructor{padding:10px;color:#222;font-family:Monaco, monospace;font-size:10px;border:0;resize:none;box-shadow:inset 1px 1px 1px #888;word-wrap:break-word;margin:12px 0;display:block;width:440px;overflow-y:scroll;height:100px;position:relative}#dg-local-explain{display:none;font-size:11px;line-height:17px;border-radius:3px;background-color:#333;padding:8px;margin-top:10px}#dg-local-explain code{font-size:10px}#dat-gui-save-locally{display:none}.dg{color:#eee;font:11px 'Lucida Grande', sans-serif;text-shadow:0 -1px 0 #111}.dg.main::-webkit-scrollbar{width:5px;background:#1a1a1a}.dg.main::-webkit-scrollbar-corner{height:0;display:none}.dg.main::-webkit-scrollbar-thumb{border-radius:5px;background:#676767}.dg li:not(.folder){background:#1a1a1a;border-bottom:1px solid #2c2c2c}.dg li.save-row{line-height:25px;background:#dad5cb;border:0}.dg li.save-row select{margin-left:5px;width:108px}.dg li.save-row .button{margin-left:5px;margin-top:1px;border-radius:2px;font-size:9px;line-height:7px;padding:4px 4px 5px 4px;background:#c5bdad;color:#fff;text-shadow:0 1px 0 #b0a58f;box-shadow:0 -1px 0 #b0a58f;cursor:pointer}.dg li.save-row .button.gears{background:#c5bdad url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAANCAYAAAB/9ZQ7AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAQJJREFUeNpiYKAU/P//PwGIC/ApCABiBSAW+I8AClAcgKxQ4T9hoMAEUrxx2QSGN6+egDX+/vWT4e7N82AMYoPAx/evwWoYoSYbACX2s7KxCxzcsezDh3evFoDEBYTEEqycggWAzA9AuUSQQgeYPa9fPv6/YWm/Acx5IPb7ty/fw+QZblw67vDs8R0YHyQhgObx+yAJkBqmG5dPPDh1aPOGR/eugW0G4vlIoTIfyFcA+QekhhHJhPdQxbiAIguMBTQZrPD7108M6roWYDFQiIAAv6Aow/1bFwXgis+f2LUAynwoIaNcz8XNx3Dl7MEJUDGQpx9gtQ8YCueB+D26OECAAQDadt7e46D42QAAAABJRU5ErkJggg==) 2px 1px no-repeat;height:7px;width:8px}.dg li.save-row .button:hover{background-color:#bab19e;box-shadow:0 -1px 0 #b0a58f}.dg li.folder{border-bottom:0}.dg li.title{padding-left:16px;background:#000 url(data:image/gif;base64,R0lGODlhBQAFAJEAAP////Pz8////////yH5BAEAAAIALAAAAAAFAAUAAAIIlI+hKgFxoCgAOw==) 6px 10px no-repeat;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.2)}.dg .closed li.title{background-image:url(data:image/gif;base64,R0lGODlhBQAFAJEAAP////Pz8////////yH5BAEAAAIALAAAAAAFAAUAAAIIlGIWqMCbWAEAOw==)}.dg .cr.boolean{border-left:3px solid #806787}.dg .cr.color{border-left:3px solid}.dg .cr.function{border-left:3px solid #e61d5f}.dg .cr.number{border-left:3px solid #2FA1D6}.dg .cr.number input[type=text]{color:#2FA1D6}.dg .cr.string{border-left:3px solid #1ed36f}.dg .cr.string input[type=text]{color:#1ed36f}.dg .cr.function:hover,.dg .cr.boolean:hover{background:#111}.dg .c input[type=text]{background:#303030;outline:none}.dg .c input[type=text]:hover{background:#3c3c3c}.dg .c input[type=text]:focus{background:#494949;color:#fff}.dg .c .slider{background:#303030;cursor:ew-resize}.dg .c .slider-fg{background:#2FA1D6;max-width:100%}.dg .c .slider:hover{background:#3c3c3c}.dg .c .slider:hover .slider-fg{background:#44abda}\n");P(I);var z="Default",M=function(){try{return !!window.localStorage}catch(e){return !1}}(),G=void 0,U=!0,X=void 0,K=!1,Y=[],J=function e(t){var n=this,i=t||{};this.domElement=document.createElement("div"),this.__ul=document.createElement("ul"),this.domElement.appendChild(this.__ul),E.addClass(this.domElement,"dg"),this.__folders={},this.__controllers=[],this.__rememberedObjects=[],this.__rememberedObjectIndecesToControllers=[],this.__listening=[],i=o.defaults(i,{closeOnTop:!1,autoPlace:!0,width:e.DEFAULT_WIDTH}),i=o.defaults(i,{resizable:i.autoPlace,hideable:i.autoPlace}),o.isUndefined(i.load)?i.load={preset:z}:i.preset&&(i.load.preset=i.preset),o.isUndefined(i.parent)&&i.hideable&&Y.push(this),i.resizable=o.isUndefined(i.parent)&&i.resizable,i.autoPlace&&o.isUndefined(i.scrollable)&&(i.scrollable=!0);var r,s=M&&"true"===localStorage.getItem(ee(this,"isLocal")),a=void 0,l=void 0;if(Object.defineProperties(this,{parent:{get:function(){return i.parent}},scrollable:{get:function(){return i.scrollable}},autoPlace:{get:function(){return i.autoPlace}},closeOnTop:{get:function(){return i.closeOnTop}},preset:{get:function(){return n.parent?n.getRoot().preset:i.load.preset},set:function(e){n.parent?n.getRoot().preset=e:i.load.preset=e,function(e){for(var t=0;t<e.__preset_select.length;t++)e.__preset_select[t].value===e.preset&&(e.__preset_select.selectedIndex=t);}(this),n.revert();}},width:{get:function(){return i.width},set:function(e){i.width=e,ie(n,e);}},name:{get:function(){return i.name},set:function(e){i.name=e,l&&(l.innerHTML=i.name);}},closed:{get:function(){return i.closed},set:function(t){i.closed=t,i.closed?E.addClass(n.__ul,e.CLASS_CLOSED):E.removeClass(n.__ul,e.CLASS_CLOSED),this.onResize(),n.__closeButton&&(n.__closeButton.innerHTML=t?e.TEXT_OPEN:e.TEXT_CLOSED);}},load:{get:function(){return i.load}},useLocalStorage:{get:function(){return s},set:function(e){M&&(s=e,e?E.bind(window,"unload",a):E.unbind(window,"unload",a),localStorage.setItem(ee(n,"isLocal"),e));}}}),o.isUndefined(i.parent)){if(this.closed=i.closed||!1,E.addClass(this.domElement,e.CLASS_MAIN),E.makeSelectable(this.domElement,!1),M&&s){n.useLocalStorage=!0;var d=localStorage.getItem(ee(this,"gui"));d&&(i.load=JSON.parse(d));}this.__closeButton=document.createElement("div"),this.__closeButton.innerHTML=e.TEXT_CLOSED,E.addClass(this.__closeButton,e.CLASS_CLOSE_BUTTON),i.closeOnTop?(E.addClass(this.__closeButton,e.CLASS_CLOSE_TOP),this.domElement.insertBefore(this.__closeButton,this.domElement.childNodes[0])):(E.addClass(this.__closeButton,e.CLASS_CLOSE_BOTTOM),this.domElement.appendChild(this.__closeButton)),E.bind(this.__closeButton,"click",(function(){n.closed=!n.closed;}));}else {void 0===i.closed&&(i.closed=!0);var c=document.createTextNode(i.name);E.addClass(c,"controller-name"),l=W(n,c);E.addClass(this.__ul,e.CLASS_CLOSED),E.addClass(l,"title"),E.bind(l,"click",(function(e){return e.preventDefault(),n.closed=!n.closed,!1})),i.closed||(this.closed=!1);}i.autoPlace&&(o.isUndefined(i.parent)&&(U&&(X=document.createElement("div"),E.addClass(X,"dg"),E.addClass(X,e.CLASS_AUTO_PLACE_CONTAINER),document.body.appendChild(X),U=!1),X.appendChild(this.domElement),E.addClass(this.domElement,e.CLASS_AUTO_PLACE)),this.parent||ie(n,i.width)),this.__resizeHandler=function(){n.onResizeDebounced();},E.bind(window,"resize",this.__resizeHandler),E.bind(this.__ul,"webkitTransitionEnd",this.__resizeHandler),E.bind(this.__ul,"transitionend",this.__resizeHandler),E.bind(this.__ul,"oTransitionEnd",this.__resizeHandler),this.onResize(),i.resizable&&oe(this),a=function(){M&&"true"===localStorage.getItem(ee(n,"isLocal"))&&localStorage.setItem(ee(n,"gui"),JSON.stringify(n.getSaveObject()));},this.saveToLocalStorageIfPossible=a,i.parent||((r=n.getRoot()).width+=1,o.defer((function(){r.width-=1;})));};function W(e,t,n){var o=document.createElement("li");return t&&o.appendChild(t),n?e.__ul.insertBefore(o,n):e.__ul.appendChild(o),e.onResize(),o}function Q(e){E.unbind(window,"resize",e.__resizeHandler),e.saveToLocalStorageIfPossible&&E.unbind(window,"unload",e.saveToLocalStorageIfPossible);}function q(e,t){var n=e.__preset_select[e.__preset_select.selectedIndex];n.innerHTML=t?n.value+"*":n.value;}function Z(e,t){var n=e.getRoot(),o=n.__rememberedObjects.indexOf(t.object);if(-1!==o){var i=n.__rememberedObjectIndecesToControllers[o];if(void 0===i&&(i={},n.__rememberedObjectIndecesToControllers[o]=i),i[t.property]=t,n.load&&n.load.remembered){var r=n.load.remembered,s=void 0;if(r[e.preset])s=r[e.preset];else {if(!r[z])return;s=r[z];}if(s[o]&&void 0!==s[o][t.property]){var a=s[o][t.property];t.initialValue=a,t.setValue(a);}}}}function $(e,t,n,i){if(void 0===t[n])throw new Error('Object "'+t+'" has no property "'+n+'"');var r=void 0;if(i.color)r=new N(t,n);else {var s=[t,n].concat(i.factoryArgs);r=D.apply(e,s);}i.before instanceof v&&(i.before=i.before.__li),Z(e,r),E.addClass(r.domElement,"c");var a=document.createElement("span");E.addClass(a,"property-name"),a.innerHTML=r.property;var l=document.createElement("div");l.appendChild(a),l.appendChild(r.domElement);var d=W(e,l,i.before);return E.addClass(d,J.CLASS_CONTROLLER_ROW),r instanceof N?E.addClass(d,"color"):E.addClass(d,c(r.getValue())),function(e,t,n){if(n.__li=t,n.__gui=e,o.extend(n,{options:function(t){if(arguments.length>1){var i=n.__li.nextElementSibling;return n.remove(),$(e,n.object,n.property,{before:i,factoryArgs:[o.toArray(arguments)]})}if(o.isArray(t)||o.isObject(t)){var r=n.__li.nextElementSibling;return n.remove(),$(e,n.object,n.property,{before:r,factoryArgs:[t]})}},name:function(e){return n.__li.firstElementChild.firstElementChild.innerHTML=e,n},listen:function(){return n.__gui.listen(n),n},remove:function(){return n.__gui.remove(n),n}}),n instanceof R){var i=new T(n.object,n.property,{min:n.__min,max:n.__max,step:n.__step});o.each(["updateDisplay","onChange","onFinishChange","step","min","max"],(function(e){var t=n[e],o=i[e];n[e]=i[e]=function(){var e=Array.prototype.slice.call(arguments);return o.apply(i,e),t.apply(n,e)};})),E.addClass(t,"has-slider"),n.domElement.insertBefore(i.domElement,n.domElement.firstElementChild);}else if(n instanceof T){var r=function(t){if(o.isNumber(n.__min)&&o.isNumber(n.__max)){var i=n.__li.firstElementChild.firstElementChild.innerHTML,r=n.__gui.__listening.indexOf(n)>-1;n.remove();var s=$(e,n.object,n.property,{before:n.__li.nextElementSibling,factoryArgs:[n.__min,n.__max,n.__step]});return s.name(i),r&&s.listen(),s}return t};n.min=o.compose(r,n.min),n.max=o.compose(r,n.max);}else n instanceof C?(E.bind(t,"click",(function(){E.fakeEvent(n.__checkbox,"click");})),E.bind(n.__checkbox,"click",(function(e){e.stopPropagation();}))):n instanceof B?(E.bind(t,"click",(function(){E.fakeEvent(n.__button,"click");})),E.bind(t,"mouseover",(function(){E.addClass(n.__button,"hover");})),E.bind(t,"mouseout",(function(){E.removeClass(n.__button,"hover");}))):n instanceof N&&(E.addClass(t,"color"),n.updateDisplay=o.compose((function(e){return t.style.borderLeftColor=n.__color.toString(),e}),n.updateDisplay),n.updateDisplay());n.setValue=o.compose((function(t){return e.getRoot().__preset_select&&n.isModified()&&q(e.getRoot(),!0),t}),n.setValue);}(e,d,r),e.__controllers.push(r),r}function ee(e,t){return document.location.href+"."+t}function te(e,t,n){var o=document.createElement("option");o.innerHTML=t,o.value=t,e.__preset_select.appendChild(o),n&&(e.__preset_select.selectedIndex=e.__preset_select.length-1);}function ne(e,t){t.style.display=e.useLocalStorage?"block":"none";}function oe(e){var t=void 0;function n(n){return n.preventDefault(),e.width+=t-n.clientX,e.onResize(),t=n.clientX,!1}function i(){E.removeClass(e.__closeButton,J.CLASS_DRAG),E.unbind(window,"mousemove",n),E.unbind(window,"mouseup",i);}function r(o){return o.preventDefault(),t=o.clientX,E.addClass(e.__closeButton,J.CLASS_DRAG),E.bind(window,"mousemove",n),E.bind(window,"mouseup",i),!1}e.__resize_handle=document.createElement("div"),o.extend(e.__resize_handle.style,{width:"6px",marginLeft:"-3px",height:"200px",cursor:"ew-resize",position:"absolute"}),E.bind(e.__resize_handle,"mousedown",r),E.bind(e.__closeButton,"mousedown",r),e.domElement.insertBefore(e.__resize_handle,e.domElement.firstElementChild);}function ie(e,t){e.domElement.style.width=t+"px",e.__save_row&&e.autoPlace&&(e.__save_row.style.width=t+"px"),e.__closeButton&&(e.__closeButton.style.width=t+"px");}function re(e,t){var n={};return o.each(e.__rememberedObjects,(function(i,r){var s={},a=e.__rememberedObjectIndecesToControllers[r];o.each(a,(function(e,n){s[n]=t?e.initialValue:e.getValue();})),n[r]=s;})),n}function se(e){0!==e.length&&V.call(window,(function(){se(e);})),o.each(e,(function(e){e.updateDisplay();}));}J.toggleHide=function(){K=!K,o.each(Y,(function(e){e.domElement.style.display=K?"none":"";}));},J.CLASS_AUTO_PLACE="a",J.CLASS_AUTO_PLACE_CONTAINER="ac",J.CLASS_MAIN="main",J.CLASS_CONTROLLER_ROW="cr",J.CLASS_TOO_TALL="taller-than-window",J.CLASS_CLOSED="closed",J.CLASS_CLOSE_BUTTON="close-button",J.CLASS_CLOSE_TOP="close-top",J.CLASS_CLOSE_BOTTOM="close-bottom",J.CLASS_DRAG="drag",J.DEFAULT_WIDTH=245,J.TEXT_CLOSED="Close Controls",J.TEXT_OPEN="Open Controls",J._keydownHandler=function(e){"text"===document.activeElement.type||72!==e.which&&72!==e.keyCode||J.toggleHide();},E.bind(window,"keydown",J._keydownHandler,!1),o.extend(J.prototype,{add:function(e,t){return $(this,e,t,{factoryArgs:Array.prototype.slice.call(arguments,2)})},addColor:function(e,t){return $(this,e,t,{color:!0})},remove:function(e){this.__ul.removeChild(e.__li),this.__controllers.splice(this.__controllers.indexOf(e),1);var t=this;o.defer((function(){t.onResize();}));},destroy:function(){if(this.parent)throw new Error("Only the root GUI should be removed with .destroy(). For subfolders, use gui.removeFolder(folder) instead.");this.autoPlace&&X.removeChild(this.domElement);var e=this;o.each(this.__folders,(function(t){e.removeFolder(t);})),E.unbind(window,"keydown",J._keydownHandler,!1),Q(this);},addFolder:function(e){if(void 0!==this.__folders[e])throw new Error('You already have a folder in this GUI by the name "'+e+'"');var t={name:e,parent:this};t.autoPlace=this.autoPlace,this.load&&this.load.folders&&this.load.folders[e]&&(t.closed=this.load.folders[e].closed,t.load=this.load.folders[e]);var n=new J(t);this.__folders[e]=n;var o=W(this,n.domElement);return E.addClass(o,"folder"),n},removeFolder:function(e){this.__ul.removeChild(e.domElement.parentElement),delete this.__folders[e.name],this.load&&this.load.folders&&this.load.folders[e.name]&&delete this.load.folders[e.name],Q(e);var t=this;o.each(e.__folders,(function(t){e.removeFolder(t);})),o.defer((function(){t.onResize();}));},open:function(){this.closed=!1;},close:function(){this.closed=!0;},hide:function(){this.domElement.style.display="none";},show:function(){this.domElement.style.display="";},onResize:function(){var e=this.getRoot();if(e.scrollable){var t=E.getOffset(e.__ul).top,n=0;o.each(e.__ul.childNodes,(function(t){e.autoPlace&&t===e.__save_row||(n+=E.getHeight(t));})),window.innerHeight-t-20<n?(E.addClass(e.domElement,J.CLASS_TOO_TALL),e.__ul.style.height=window.innerHeight-t-20+"px"):(E.removeClass(e.domElement,J.CLASS_TOO_TALL),e.__ul.style.height="auto");}e.__resize_handle&&o.defer((function(){e.__resize_handle.style.height=e.__ul.offsetHeight+"px";})),e.__closeButton&&(e.__closeButton.style.width=e.width+"px");},onResizeDebounced:o.debounce((function(){this.onResize();}),50),remember:function(){if(o.isUndefined(G)&&((G=new j).domElement.innerHTML='<div id="dg-save" class="dg dialogue">\n\n  Here\'s the new load parameter for your <code>GUI</code>\'s constructor:\n\n  <textarea id="dg-new-constructor"></textarea>\n\n  <div id="dg-save-locally">\n\n    <input id="dg-local-storage" type="checkbox"/> Automatically save\n    values to <code>localStorage</code> on exit.\n\n    <div id="dg-local-explain">The values saved to <code>localStorage</code> will\n      override those passed to <code>dat.GUI</code>\'s constructor. This makes it\n      easier to work incrementally, but <code>localStorage</code> is fragile,\n      and your friends may not see the same values you do.\n\n    </div>\n\n  </div>\n\n</div>'),this.parent)throw new Error("You can only call remember on a top level GUI.");var e=this;o.each(Array.prototype.slice.call(arguments),(function(t){0===e.__rememberedObjects.length&&function(e){var t=e.__save_row=document.createElement("li");E.addClass(e.domElement,"has-save"),e.__ul.insertBefore(t,e.__ul.firstChild),E.addClass(t,"save-row");var n=document.createElement("span");n.innerHTML="&nbsp;",E.addClass(n,"button gears");var i=document.createElement("span");i.innerHTML="Save",E.addClass(i,"button"),E.addClass(i,"save");var r=document.createElement("span");r.innerHTML="New",E.addClass(r,"button"),E.addClass(r,"save-as");var s=document.createElement("span");s.innerHTML="Revert",E.addClass(s,"button"),E.addClass(s,"revert");var a=e.__preset_select=document.createElement("select");e.load&&e.load.remembered?o.each(e.load.remembered,(function(t,n){te(e,n,n===e.preset);})):te(e,z,!1);if(E.bind(a,"change",(function(){for(var t=0;t<e.__preset_select.length;t++)e.__preset_select[t].innerHTML=e.__preset_select[t].value;e.preset=this.value;})),t.appendChild(a),t.appendChild(n),t.appendChild(i),t.appendChild(r),t.appendChild(s),M){var l=document.getElementById("dg-local-explain"),d=document.getElementById("dg-local-storage");document.getElementById("dg-save-locally").style.display="block","true"===localStorage.getItem(ee(e,"isLocal"))&&d.setAttribute("checked","checked"),ne(e,l),E.bind(d,"change",(function(){e.useLocalStorage=!e.useLocalStorage,ne(e,l);}));}var c=document.getElementById("dg-new-constructor");E.bind(c,"keydown",(function(e){!e.metaKey||67!==e.which&&67!==e.keyCode||G.hide();})),E.bind(n,"click",(function(){c.innerHTML=JSON.stringify(e.getSaveObject(),void 0,2),G.show(),c.focus(),c.select();})),E.bind(i,"click",(function(){e.save();})),E.bind(r,"click",(function(){var t=prompt("Enter a new preset name.");t&&e.saveAs(t);})),E.bind(s,"click",(function(){e.revert();}));}(e),-1===e.__rememberedObjects.indexOf(t)&&e.__rememberedObjects.push(t);})),this.autoPlace&&ie(this,this.width);},getRoot:function(){for(var e=this;e.parent;)e=e.parent;return e},getSaveObject:function(){var e=this.load;return e.closed=this.closed,this.__rememberedObjects.length>0&&(e.preset=this.preset,e.remembered||(e.remembered={}),e.remembered[this.preset]=re(this)),e.folders={},o.each(this.__folders,(function(t,n){e.folders[n]=t.getSaveObject();})),e},save:function(){this.load.remembered||(this.load.remembered={}),this.load.remembered[this.preset]=re(this),q(this,!1),this.saveToLocalStorageIfPossible();},saveAs:function(e){this.load.remembered||(this.load.remembered={},this.load.remembered[z]=re(this,!0)),this.load.remembered[e]=re(this),this.preset=e,te(this,e,!0),this.saveToLocalStorageIfPossible();},revert:function(e){o.each(this.__controllers,(function(t){this.getRoot().load.remembered?Z(e||this.getRoot(),t):t.setValue(t.initialValue),t.__onFinishChange&&t.__onFinishChange.call(t,t.getValue());}),this),o.each(this.__folders,(function(e){e.revert(e);})),e||q(this.getRoot(),!1);},listen:function(e){var t=0===this.__listening.length;this.__listening.push(e),t&&se(this.__listening);},updateDisplay:function(){o.each(this.__controllers,(function(e){e.updateDisplay();})),o.each(this.__folders,(function(e){e.updateDisplay();}));}});var ue=J;

// extracted from SkeletonUtils.clone
function skinnedMeshClone( source ) {

    var sourceLookup = new Map();
    var cloneLookup = new Map();
  
    var clone = source.clone();
  
    parallelTraverse( source, clone, function ( sourceNode, clonedNode ) {
  
      sourceLookup.set( clonedNode, sourceNode );
      cloneLookup.set( sourceNode, clonedNode );
  
    } );
  
    clone.traverse( function ( node ) {
  
      if ( ! node.isSkinnedMesh ) return;
  
      var clonedMesh = node;
      var sourceMesh = sourceLookup.get( node );
      var sourceBones = sourceMesh.skeleton.bones;
  
      clonedMesh.skeleton = sourceMesh.skeleton.clone();
      clonedMesh.bindMatrix.copy( sourceMesh.bindMatrix );
  
      clonedMesh.skeleton.bones = sourceBones.map( function ( bone ) {
  
        // || bone.clone() is needed when bones are not in children
        return cloneLookup.get( bone ) || bone.clone();
  
      } );
  
      clonedMesh.bind( clonedMesh.skeleton, clonedMesh.bindMatrix );
  
    } );
  
    return clone;
  
  }
  function parallelTraverse( a, b, callback ) {
  
      callback( a, b );
  
      for ( var i = 0; i < a.children.length; i ++ ) {
  
          parallelTraverse( a.children[ i ], b.children[ i ], callback );
  
      }
  
  }

var camera, ocontrols, modelGroup, modelOptimized, modelOptimizedGroup, modelMaxSize, modelMaxWidthDepth, fileLoader, close, done;
var boneCosts = {};
function openOptimizer (model, onDone) {
  const webglContainer = createDOM();
  const { scene, controls } = init(webglContainer);
  done = onDone;

  createWorkers();
  setupNewObject(scene, model, controls, webglContainer);
}

function setBoneCosts (newBoneCosts) {
  boneCosts = newBoneCosts;
}

function createDOM () {
  const parent = document.createElement('div');
  parent.style.position = 'absolute';
  parent.style.top = 0;
  parent.style.left = 0;
  parent.style.width = '100%';
  parent.style.height = '100%';
  parent.style.zIndex = 2000;


  const webglOutput = document.createElement('div');
  webglOutput.id = 'WebGL-output';
  webglOutput.style.position = 'absolute';
  webglOutput.style.top = 0;
  webglOutput.style.left = 0;
  parent.appendChild(webglOutput);

  const closeButton = document.createElement('div');
  closeButton.style.position = 'absolute';
  closeButton.style.top = '10x';
  closeButton.style.right = 0;
  closeButton.style.padding = '10px';
  closeButton.style.fontWeight = 'bold';
  closeButton.style.fontSize = '25px';
  closeButton.style.backgroundColor = 'white';
  closeButton.textContent = 'X';
  parent.appendChild(closeButton);

  document.body.appendChild(parent);

  closeButton.addEventListener('click', () => {
    close();
  });

  close = function close() {
    localStorage.stopEverything = true;
    parent.removeChild(webglOutput);
    parent.removeChild(closeButton);
    document.body.removeChild(parent);
    camera = ocontrols = modelGroup = modelOptimized = modelMaxSize = modelMaxWidthDepth = fileLoader = null;
  };

  return webglOutput;
}

function apply() {
  done(modelOptimized);
  close();
}

function init(webglContainer) {
  window.restoreConsole && window.restoreConsole();
  const models = {
    '': '',
    Elf:
      'https://rawgit.com/mrdoob/three.js/master/examples/models/collada/elf/elf.dae',
    Drone: '/static/character.json'
  };

  const gui = setupGUI(webglContainer, models);

  const scene = setupScene();

  const renderer = setupRenderer(scene[0], scene[1], gui.controls);
  webglContainer.appendChild(renderer.domElement);

  return {
    scene: scene[0],
    controls: gui.controls
  };
}

function setupGUI(webglContainer, models) {
  var controls = new function() {
    this.state = Object.keys(models)[0];
    this.rotationSpeed = 0.01;
    this.optimizationLevel = 0.3;
    this.maximumCost = 5;
    this.optimizeModel = () => optimizeModel(controls);
    this.apply = () => apply();
    this.preserveTexture = true;

    this.wireframe = false;
  }();

  localStorage.startTime = Date.now();

  var gui = new ue();
  gui.controls = controls;
  const dropdown = gui.add(controls, 'state').options(Object.keys(models));

  dropdown.onChange(item => {
    fileLoader.load(models[item]);
  });
  // setTimeout(() => {
  //   dropdown.setValue(Object.keys(models)[1]);
  // }, 1000);

  gui.add(controls, 'rotationSpeed', 0, 0.06);
  gui.add(controls, 'optimizationLevel', 0, 1);
  gui.add(controls, 'maximumCost', 1, 20);
  gui.add(controls, 'preserveTexture');
  gui.add(controls, 'wireframe');
  gui.add(controls, 'optimizeModel');
  gui.add(controls, 'apply');

  webglContainer.parentNode.insertBefore(
    gui.domElement,
    webglContainer
  );

  gui.domElement.style.position = 'absolute';
  gui.domElement.style.zIndex = 2000;
  gui.domElement.style.right = '40px';

  return gui;
}

function setupScene() {
  var scene = new Scene();
  // setupDropzone(scene);
  camera = new PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
  );
  scene.add(camera);

  // add subtle ambient lighting
  var ambientLight = new AmbientLight(0x444444);
  scene.add(ambientLight);
  // add spotlight for the shadows
  var spotLight = new SpotLight(0xffffff);
  spotLight.position.set(-40, 60, -10);
  spotLight.castShadow = true;
  scene.add(spotLight);

  var light = new HemisphereLight(0xbbbbff, 0x444422);
  light.position.set(0, 1, 0);
  scene.add(light);

  return [ scene, camera ];
}

function setupRenderer(scene, camera, controls) {
  var renderer = new WebGLRenderer({ antialias: true });
  renderer.setClearColor(new Color(0.7, 0.8, 0.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;

  localStorage.stopEverything = 'true';
  setTimeout(() => {
    localStorage.stopEverything = 'false';
    requestAnimationFrame(getRenderer(scene, camera, renderer, controls));
  }, 500);

  return renderer;

}

function recursivelyOptimize(model, controls) {
  if (model.isMesh) {
    if (!model.geometry.boundingBox) {
      model.geometry.computeBoundingBox();
    }
    const box = model.geometry.boundingBox;
    const modelSize = Math.max(
      (box.max.x - box.min.x) * model.scale.x,
      (box.max.y - box.min.y) * model.scale.y,
      (box.max.z - box.min.z) * model.scale.z
    );
    const geo = model.originalGeometry || model.geometry;
    if (model.skeleton) {
      geo.skeleton = model.skeleton;
      geo.boneCosts = boneCosts;
    }
    meshSimplifier(
      geo,
      controls.optimizationLevel,
      controls.maximumCost,
      modelSize,
      controls.preserveTexture
    ).then(newGeo => {
      model.geometry = newGeo;
    });
  }
  model.children.forEach(child => recursivelyOptimize(child, controls));
}

function optimizeModel(controls) {
  if (modelOptimized) {
    modelOptimized.geometry =
      modelOptimized.originalGeometry;
  } else {
    modelOptimized.geometry = modelOptimized.originalGeometry;
  }

  recursivelyOptimize(modelOptimized, controls);

  modelOptimizedGroup.position.x = modelMaxWidthDepth;
}

function getRenderer(scene, camera, renderer, controls) {
  const render = function () {
    if (modelGroup) {
      modelGroup.rotation.y += controls.rotationSpeed;
      toWireframe(modelGroup, controls.wireframe);
      if (modelOptimizedGroup) {
        modelOptimizedGroup.rotation.copy(modelGroup.rotation);
      }
    }

    if (localStorage.stopEverything === 'false') {
      requestAnimationFrame(render);
      renderer.render(scene, camera);
    } else {
      console.log('stopping rendering');
      // killWorkers();
      // document.removeEventListener('drop', handleFileDrop, false);
      // document.removeEventListener('dragover', handleDragOver, false);
    }
  };
  return render;
}

function toWireframe(obj, wireframeMode) {
  if (Array.isArray(obj.material)) {
    obj.material.forEach(m => (m.wireframe = wireframeMode));
  } else if (obj.material) {
    obj.material.wireframe = wireframeMode;
  }
  obj.children.forEach(el => toWireframe(el, wireframeMode));
}

fileLoader = new Loader(obj => setupNewObject(obj));

function setupNewObject(scene, obj, controls, domElement) {
  scene.remove(modelGroup);
  scene.remove(modelOptimizedGroup);

  modelGroup = new Group();
  modelGroup.add(obj);
  modelOptimized = obj.isSkinnedMesh ? skinnedMeshClone(obj) : obj.clone();
  if (modelOptimized) {
    modelOptimized.originalGeometry =
      modelOptimized.geometry;
  } else {
    modelOptimized.originalGeometry = modelOptimized.geometry;
  }

  modelOptimizedGroup = new Group();
  modelOptimizedGroup.add(modelOptimized);
  scene.add(modelGroup);
  scene.add(modelOptimizedGroup);

  // update camera position to contain entire camera in view
  const boxScale = new Box3();
  boxScale.setFromObject(modelGroup);
  modelMaxWidthDepth =
    Math.max(
      boxScale.max.x - boxScale.min.x,
      boxScale.max.z - boxScale.min.z
    ) * 1.1; // * 1.1 for padding

  modelMaxSize = Math.max(
    boxScale.max.x - boxScale.min.x,
    boxScale.max.y - boxScale.min.y,
    boxScale.max.z - boxScale.min.z
  );

  camera.position.set(
    0,
    boxScale.max.y - boxScale.min.y,
    Math.abs(modelMaxSize * 3)
  );

  ocontrols = new OrbitControls(camera, domElement);
  ocontrols.target.set(modelMaxWidthDepth / 2, (boxScale.max.y - boxScale.min.y) / 2, 0);

  optimizeModel(controls);

  if (OrbitControls) {
    ocontrols.update();
  }
}
// function setupDropzone(scene) {
//   document.addEventListener('dragover', handleDragOver, false);
//   document.addEventListener('drop', handleFileDrop, false);
// }
// function handleDragOver(event) {
//   event.preventDefault();
//   event.dataTransfer.dropEffect = 'copy';
// }
// function handleFileDrop(event) {
//   event.preventDefault();
//   if (event.dataTransfer.files.length > 0) {
//     fileLoader.loadFiles(event.dataTransfer.files);
//   }
// }

function editorAction(editor) {
  if (!editor.selected) {
    return alert('select an object');
  }
  if (!editor.selected.isMesh) {
    return alert('select valid geometry');
  }

  const selected = editor.selected;

  openOptimizer(selected.isSkinnedMesh ? skinnedMeshClone(selected) : selected.clone(), onDone);

  function onDone(optimizedMesh) {
    optimizedMesh.position.copy(selected.position);
    optimizedMesh.rotation.copy(selected.rotation);
    optimizedMesh.scale.copy(selected.scale);

    editor.scene.remove(editor.selected);
    editor.scene.add(optimizedMesh);
    editor.signals.sceneGraphChanged.dispatch();
  }

  // meshSimplifier(editor.selected.geometry, 0.5).then(simplified => {
  //   selected.geometry = simplified;
  // });
}

const editorPlugin = {
  name: 'optimesh',
  humanName: 'OptiMesh',
  nativeAction: meshSimplifier,
  editorAction: editorAction,
};

const OptiMesh = {
  createWorkers,
  meshSimplifier,
  editorPlugin,
  openOptimizer,
  setBoneCosts,
};
// export { createWorkers, meshSimplifier };

export default OptiMesh;
