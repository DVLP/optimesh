var dvlpThree = (typeof dvlpThree !== 'undefined' && dvlpThree) || (typeof dvlpThree$1 !== 'undefined' && dvlpThree$1) || (typeof THREE !== 'undefined' && THREE);
var optimesh = (function (exports) {
	'use strict';

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

	    if(geometry.index) {
	      const indexSAB = new SAB(geometry.index.array.length * 4);
	      const indexArr = new Uint32Array(indexSAB);
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

	    const faceCount = position.length / 3 / 3;

	    const largeIndexes = faceCount * 3 > 65536;
	    const indexBuffer = new SAB(
	      faceCount * 3 * (largeIndexes ? 4 : 2)
	    );
	    const UIntConstructor = largeIndexes ? Uint32Array : Uint16Array;
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

	// import { Vector2, Vector3, BufferAttribute, BufferGeometry } from 'dvlp-three';
	const {
	  Vector2, Vector3, BufferAttribute, BufferGeometry
	} = dvlpThree;
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
	const MAX_WORKERS_PER_OBJECT = typeof SharedArrayBuffer === 'undefined' ? 1 : navigator.hardwareConcurrency;
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

	function killWorkers() {
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

	function meshSimplifier(
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
	  }  return new Promise((resolve, reject) => {
	    if (discardSimpleGeometry(geometry)) {
	      return resolve(geometry);
	    }
	    if (geometry.index) {
	      geometry = geometry.toNonIndexed();
	    }

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
	    console.time('reusing arrays');
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
	    console.timeEnd('reusing arrays');
	    return reusingDataArrays;
	  }

	  previousVertexCount = verexCount;
	  const SAB =
	    typeof SharedArrayBuffer === 'undefined' ? ArrayBuffer : SharedArrayBuffer;
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
	    const positionsCount = geometry.index
	      ? geometry.attributes.position.count
	      : geometry.attributes.position.count;
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
	    Object.keys(geometry.boneCosts).forEach(boneName => {
	      const idx = geometry.skeleton.bones.findIndex(bone => bone.name === boneName);
	      if (!idx) return
	      boneCosts[idx] = geometry.boneCosts[boneName];
	    });
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
	      if (typeof SharedArrayBuffer === 'undefined') {
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

	      if (event.data.task === 'simplificationError') {
	        errorMessages.push(event.data.message);
	        aborting = true;
	      } else if (
	        event.data.task === 'edgesCostsDone' &&
	        doneCount >= workers.length
	      ) {
	        if (typeof SharedArrayBuffer === 'undefined') {
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
	  const mapNewToOld = [];
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

	  mapNewToOld.sort();
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

	  const index = new Uint32Array(faceCount * 4);

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

	/**
	 * dat-gui JavaScript Controller Library
	 * http://code.google.com/p/dat-gui
	 *
	 * Copyright 2011 Data Arts Team, Google Creative Lab
	 *
	 * Licensed under the Apache License, Version 2.0 (the "License");
	 * you may not use this file except in compliance with the License.
	 * You may obtain a copy of the License at
	 *
	 * http://www.apache.org/licenses/LICENSE-2.0
	 */

	function ___$insertStyle(css) {
	  if (!css) {
	    return;
	  }
	  if (typeof window === 'undefined') {
	    return;
	  }

	  var style = document.createElement('style');

	  style.setAttribute('type', 'text/css');
	  style.innerHTML = css;
	  document.head.appendChild(style);

	  return css;
	}

	function colorToString (color, forceCSSHex) {
	  var colorFormat = color.__state.conversionName.toString();
	  var r = Math.round(color.r);
	  var g = Math.round(color.g);
	  var b = Math.round(color.b);
	  var a = color.a;
	  var h = Math.round(color.h);
	  var s = color.s.toFixed(1);
	  var v = color.v.toFixed(1);
	  if (forceCSSHex || colorFormat === 'THREE_CHAR_HEX' || colorFormat === 'SIX_CHAR_HEX') {
	    var str = color.hex.toString(16);
	    while (str.length < 6) {
	      str = '0' + str;
	    }
	    return '#' + str;
	  } else if (colorFormat === 'CSS_RGB') {
	    return 'rgb(' + r + ',' + g + ',' + b + ')';
	  } else if (colorFormat === 'CSS_RGBA') {
	    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
	  } else if (colorFormat === 'HEX') {
	    return '0x' + color.hex.toString(16);
	  } else if (colorFormat === 'RGB_ARRAY') {
	    return '[' + r + ',' + g + ',' + b + ']';
	  } else if (colorFormat === 'RGBA_ARRAY') {
	    return '[' + r + ',' + g + ',' + b + ',' + a + ']';
	  } else if (colorFormat === 'RGB_OBJ') {
	    return '{r:' + r + ',g:' + g + ',b:' + b + '}';
	  } else if (colorFormat === 'RGBA_OBJ') {
	    return '{r:' + r + ',g:' + g + ',b:' + b + ',a:' + a + '}';
	  } else if (colorFormat === 'HSV_OBJ') {
	    return '{h:' + h + ',s:' + s + ',v:' + v + '}';
	  } else if (colorFormat === 'HSVA_OBJ') {
	    return '{h:' + h + ',s:' + s + ',v:' + v + ',a:' + a + '}';
	  }
	  return 'unknown format';
	}

	var ARR_EACH = Array.prototype.forEach;
	var ARR_SLICE = Array.prototype.slice;
	var Common = {
	  BREAK: {},
	  extend: function extend(target) {
	    this.each(ARR_SLICE.call(arguments, 1), function (obj) {
	      var keys = this.isObject(obj) ? Object.keys(obj) : [];
	      keys.forEach(function (key) {
	        if (!this.isUndefined(obj[key])) {
	          target[key] = obj[key];
	        }
	      }.bind(this));
	    }, this);
	    return target;
	  },
	  defaults: function defaults(target) {
	    this.each(ARR_SLICE.call(arguments, 1), function (obj) {
	      var keys = this.isObject(obj) ? Object.keys(obj) : [];
	      keys.forEach(function (key) {
	        if (this.isUndefined(target[key])) {
	          target[key] = obj[key];
	        }
	      }.bind(this));
	    }, this);
	    return target;
	  },
	  compose: function compose() {
	    var toCall = ARR_SLICE.call(arguments);
	    return function () {
	      var args = ARR_SLICE.call(arguments);
	      for (var i = toCall.length - 1; i >= 0; i--) {
	        args = [toCall[i].apply(this, args)];
	      }
	      return args[0];
	    };
	  },
	  each: function each(obj, itr, scope) {
	    if (!obj) {
	      return;
	    }
	    if (ARR_EACH && obj.forEach && obj.forEach === ARR_EACH) {
	      obj.forEach(itr, scope);
	    } else if (obj.length === obj.length + 0) {
	      var key = void 0;
	      var l = void 0;
	      for (key = 0, l = obj.length; key < l; key++) {
	        if (key in obj && itr.call(scope, obj[key], key) === this.BREAK) {
	          return;
	        }
	      }
	    } else {
	      for (var _key in obj) {
	        if (itr.call(scope, obj[_key], _key) === this.BREAK) {
	          return;
	        }
	      }
	    }
	  },
	  defer: function defer(fnc) {
	    setTimeout(fnc, 0);
	  },
	  debounce: function debounce(func, threshold, callImmediately) {
	    var timeout = void 0;
	    return function () {
	      var obj = this;
	      var args = arguments;
	      function delayed() {
	        timeout = null;
	        if (!callImmediately) func.apply(obj, args);
	      }
	      var callNow = callImmediately || !timeout;
	      clearTimeout(timeout);
	      timeout = setTimeout(delayed, threshold);
	      if (callNow) {
	        func.apply(obj, args);
	      }
	    };
	  },
	  toArray: function toArray(obj) {
	    if (obj.toArray) return obj.toArray();
	    return ARR_SLICE.call(obj);
	  },
	  isUndefined: function isUndefined(obj) {
	    return obj === undefined;
	  },
	  isNull: function isNull(obj) {
	    return obj === null;
	  },
	  isNaN: function (_isNaN) {
	    function isNaN(_x) {
	      return _isNaN.apply(this, arguments);
	    }
	    isNaN.toString = function () {
	      return _isNaN.toString();
	    };
	    return isNaN;
	  }(function (obj) {
	    return isNaN(obj);
	  }),
	  isArray: Array.isArray || function (obj) {
	    return obj.constructor === Array;
	  },
	  isObject: function isObject(obj) {
	    return obj === Object(obj);
	  },
	  isNumber: function isNumber(obj) {
	    return obj === obj + 0;
	  },
	  isString: function isString(obj) {
	    return obj === obj + '';
	  },
	  isBoolean: function isBoolean(obj) {
	    return obj === false || obj === true;
	  },
	  isFunction: function isFunction(obj) {
	    return obj instanceof Function;
	  }
	};

	var INTERPRETATIONS = [
	{
	  litmus: Common.isString,
	  conversions: {
	    THREE_CHAR_HEX: {
	      read: function read(original) {
	        var test = original.match(/^#([A-F0-9])([A-F0-9])([A-F0-9])$/i);
	        if (test === null) {
	          return false;
	        }
	        return {
	          space: 'HEX',
	          hex: parseInt('0x' + test[1].toString() + test[1].toString() + test[2].toString() + test[2].toString() + test[3].toString() + test[3].toString(), 0)
	        };
	      },
	      write: colorToString
	    },
	    SIX_CHAR_HEX: {
	      read: function read(original) {
	        var test = original.match(/^#([A-F0-9]{6})$/i);
	        if (test === null) {
	          return false;
	        }
	        return {
	          space: 'HEX',
	          hex: parseInt('0x' + test[1].toString(), 0)
	        };
	      },
	      write: colorToString
	    },
	    CSS_RGB: {
	      read: function read(original) {
	        var test = original.match(/^rgb\(\s*(.+)\s*,\s*(.+)\s*,\s*(.+)\s*\)/);
	        if (test === null) {
	          return false;
	        }
	        return {
	          space: 'RGB',
	          r: parseFloat(test[1]),
	          g: parseFloat(test[2]),
	          b: parseFloat(test[3])
	        };
	      },
	      write: colorToString
	    },
	    CSS_RGBA: {
	      read: function read(original) {
	        var test = original.match(/^rgba\(\s*(.+)\s*,\s*(.+)\s*,\s*(.+)\s*,\s*(.+)\s*\)/);
	        if (test === null) {
	          return false;
	        }
	        return {
	          space: 'RGB',
	          r: parseFloat(test[1]),
	          g: parseFloat(test[2]),
	          b: parseFloat(test[3]),
	          a: parseFloat(test[4])
	        };
	      },
	      write: colorToString
	    }
	  }
	},
	{
	  litmus: Common.isNumber,
	  conversions: {
	    HEX: {
	      read: function read(original) {
	        return {
	          space: 'HEX',
	          hex: original,
	          conversionName: 'HEX'
	        };
	      },
	      write: function write(color) {
	        return color.hex;
	      }
	    }
	  }
	},
	{
	  litmus: Common.isArray,
	  conversions: {
	    RGB_ARRAY: {
	      read: function read(original) {
	        if (original.length !== 3) {
	          return false;
	        }
	        return {
	          space: 'RGB',
	          r: original[0],
	          g: original[1],
	          b: original[2]
	        };
	      },
	      write: function write(color) {
	        return [color.r, color.g, color.b];
	      }
	    },
	    RGBA_ARRAY: {
	      read: function read(original) {
	        if (original.length !== 4) return false;
	        return {
	          space: 'RGB',
	          r: original[0],
	          g: original[1],
	          b: original[2],
	          a: original[3]
	        };
	      },
	      write: function write(color) {
	        return [color.r, color.g, color.b, color.a];
	      }
	    }
	  }
	},
	{
	  litmus: Common.isObject,
	  conversions: {
	    RGBA_OBJ: {
	      read: function read(original) {
	        if (Common.isNumber(original.r) && Common.isNumber(original.g) && Common.isNumber(original.b) && Common.isNumber(original.a)) {
	          return {
	            space: 'RGB',
	            r: original.r,
	            g: original.g,
	            b: original.b,
	            a: original.a
	          };
	        }
	        return false;
	      },
	      write: function write(color) {
	        return {
	          r: color.r,
	          g: color.g,
	          b: color.b,
	          a: color.a
	        };
	      }
	    },
	    RGB_OBJ: {
	      read: function read(original) {
	        if (Common.isNumber(original.r) && Common.isNumber(original.g) && Common.isNumber(original.b)) {
	          return {
	            space: 'RGB',
	            r: original.r,
	            g: original.g,
	            b: original.b
	          };
	        }
	        return false;
	      },
	      write: function write(color) {
	        return {
	          r: color.r,
	          g: color.g,
	          b: color.b
	        };
	      }
	    },
	    HSVA_OBJ: {
	      read: function read(original) {
	        if (Common.isNumber(original.h) && Common.isNumber(original.s) && Common.isNumber(original.v) && Common.isNumber(original.a)) {
	          return {
	            space: 'HSV',
	            h: original.h,
	            s: original.s,
	            v: original.v,
	            a: original.a
	          };
	        }
	        return false;
	      },
	      write: function write(color) {
	        return {
	          h: color.h,
	          s: color.s,
	          v: color.v,
	          a: color.a
	        };
	      }
	    },
	    HSV_OBJ: {
	      read: function read(original) {
	        if (Common.isNumber(original.h) && Common.isNumber(original.s) && Common.isNumber(original.v)) {
	          return {
	            space: 'HSV',
	            h: original.h,
	            s: original.s,
	            v: original.v
	          };
	        }
	        return false;
	      },
	      write: function write(color) {
	        return {
	          h: color.h,
	          s: color.s,
	          v: color.v
	        };
	      }
	    }
	  }
	}];
	var result = void 0;
	var toReturn = void 0;
	var interpret = function interpret() {
	  toReturn = false;
	  var original = arguments.length > 1 ? Common.toArray(arguments) : arguments[0];
	  Common.each(INTERPRETATIONS, function (family) {
	    if (family.litmus(original)) {
	      Common.each(family.conversions, function (conversion, conversionName) {
	        result = conversion.read(original);
	        if (toReturn === false && result !== false) {
	          toReturn = result;
	          result.conversionName = conversionName;
	          result.conversion = conversion;
	          return Common.BREAK;
	        }
	      });
	      return Common.BREAK;
	    }
	  });
	  return toReturn;
	};

	var tmpComponent = void 0;
	var ColorMath = {
	  hsv_to_rgb: function hsv_to_rgb(h, s, v) {
	    var hi = Math.floor(h / 60) % 6;
	    var f = h / 60 - Math.floor(h / 60);
	    var p = v * (1.0 - s);
	    var q = v * (1.0 - f * s);
	    var t = v * (1.0 - (1.0 - f) * s);
	    var c = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][hi];
	    return {
	      r: c[0] * 255,
	      g: c[1] * 255,
	      b: c[2] * 255
	    };
	  },
	  rgb_to_hsv: function rgb_to_hsv(r, g, b) {
	    var min = Math.min(r, g, b);
	    var max = Math.max(r, g, b);
	    var delta = max - min;
	    var h = void 0;
	    var s = void 0;
	    if (max !== 0) {
	      s = delta / max;
	    } else {
	      return {
	        h: NaN,
	        s: 0,
	        v: 0
	      };
	    }
	    if (r === max) {
	      h = (g - b) / delta;
	    } else if (g === max) {
	      h = 2 + (b - r) / delta;
	    } else {
	      h = 4 + (r - g) / delta;
	    }
	    h /= 6;
	    if (h < 0) {
	      h += 1;
	    }
	    return {
	      h: h * 360,
	      s: s,
	      v: max / 255
	    };
	  },
	  rgb_to_hex: function rgb_to_hex(r, g, b) {
	    var hex = this.hex_with_component(0, 2, r);
	    hex = this.hex_with_component(hex, 1, g);
	    hex = this.hex_with_component(hex, 0, b);
	    return hex;
	  },
	  component_from_hex: function component_from_hex(hex, componentIndex) {
	    return hex >> componentIndex * 8 & 0xFF;
	  },
	  hex_with_component: function hex_with_component(hex, componentIndex, value) {
	    return value << (tmpComponent = componentIndex * 8) | hex & ~(0xFF << tmpComponent);
	  }
	};

	var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
	  return typeof obj;
	} : function (obj) {
	  return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
	};











	var classCallCheck = function (instance, Constructor) {
	  if (!(instance instanceof Constructor)) {
	    throw new TypeError("Cannot call a class as a function");
	  }
	};

	var createClass = function () {
	  function defineProperties(target, props) {
	    for (var i = 0; i < props.length; i++) {
	      var descriptor = props[i];
	      descriptor.enumerable = descriptor.enumerable || false;
	      descriptor.configurable = true;
	      if ("value" in descriptor) descriptor.writable = true;
	      Object.defineProperty(target, descriptor.key, descriptor);
	    }
	  }

	  return function (Constructor, protoProps, staticProps) {
	    if (protoProps) defineProperties(Constructor.prototype, protoProps);
	    if (staticProps) defineProperties(Constructor, staticProps);
	    return Constructor;
	  };
	}();







	var get = function get(object, property, receiver) {
	  if (object === null) object = Function.prototype;
	  var desc = Object.getOwnPropertyDescriptor(object, property);

	  if (desc === undefined) {
	    var parent = Object.getPrototypeOf(object);

	    if (parent === null) {
	      return undefined;
	    } else {
	      return get(parent, property, receiver);
	    }
	  } else if ("value" in desc) {
	    return desc.value;
	  } else {
	    var getter = desc.get;

	    if (getter === undefined) {
	      return undefined;
	    }

	    return getter.call(receiver);
	  }
	};

	var inherits = function (subClass, superClass) {
	  if (typeof superClass !== "function" && superClass !== null) {
	    throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
	  }

	  subClass.prototype = Object.create(superClass && superClass.prototype, {
	    constructor: {
	      value: subClass,
	      enumerable: false,
	      writable: true,
	      configurable: true
	    }
	  });
	  if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
	};











	var possibleConstructorReturn = function (self, call) {
	  if (!self) {
	    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
	  }

	  return call && (typeof call === "object" || typeof call === "function") ? call : self;
	};

	var Color = function () {
	  function Color() {
	    classCallCheck(this, Color);
	    this.__state = interpret.apply(this, arguments);
	    if (this.__state === false) {
	      throw new Error('Failed to interpret color arguments');
	    }
	    this.__state.a = this.__state.a || 1;
	  }
	  createClass(Color, [{
	    key: 'toString',
	    value: function toString() {
	      return colorToString(this);
	    }
	  }, {
	    key: 'toHexString',
	    value: function toHexString() {
	      return colorToString(this, true);
	    }
	  }, {
	    key: 'toOriginal',
	    value: function toOriginal() {
	      return this.__state.conversion.write(this);
	    }
	  }]);
	  return Color;
	}();
	function defineRGBComponent(target, component, componentHexIndex) {
	  Object.defineProperty(target, component, {
	    get: function get$$1() {
	      if (this.__state.space === 'RGB') {
	        return this.__state[component];
	      }
	      Color.recalculateRGB(this, component, componentHexIndex);
	      return this.__state[component];
	    },
	    set: function set$$1(v) {
	      if (this.__state.space !== 'RGB') {
	        Color.recalculateRGB(this, component, componentHexIndex);
	        this.__state.space = 'RGB';
	      }
	      this.__state[component] = v;
	    }
	  });
	}
	function defineHSVComponent(target, component) {
	  Object.defineProperty(target, component, {
	    get: function get$$1() {
	      if (this.__state.space === 'HSV') {
	        return this.__state[component];
	      }
	      Color.recalculateHSV(this);
	      return this.__state[component];
	    },
	    set: function set$$1(v) {
	      if (this.__state.space !== 'HSV') {
	        Color.recalculateHSV(this);
	        this.__state.space = 'HSV';
	      }
	      this.__state[component] = v;
	    }
	  });
	}
	Color.recalculateRGB = function (color, component, componentHexIndex) {
	  if (color.__state.space === 'HEX') {
	    color.__state[component] = ColorMath.component_from_hex(color.__state.hex, componentHexIndex);
	  } else if (color.__state.space === 'HSV') {
	    Common.extend(color.__state, ColorMath.hsv_to_rgb(color.__state.h, color.__state.s, color.__state.v));
	  } else {
	    throw new Error('Corrupted color state');
	  }
	};
	Color.recalculateHSV = function (color) {
	  var result = ColorMath.rgb_to_hsv(color.r, color.g, color.b);
	  Common.extend(color.__state, {
	    s: result.s,
	    v: result.v
	  });
	  if (!Common.isNaN(result.h)) {
	    color.__state.h = result.h;
	  } else if (Common.isUndefined(color.__state.h)) {
	    color.__state.h = 0;
	  }
	};
	Color.COMPONENTS = ['r', 'g', 'b', 'h', 's', 'v', 'hex', 'a'];
	defineRGBComponent(Color.prototype, 'r', 2);
	defineRGBComponent(Color.prototype, 'g', 1);
	defineRGBComponent(Color.prototype, 'b', 0);
	defineHSVComponent(Color.prototype, 'h');
	defineHSVComponent(Color.prototype, 's');
	defineHSVComponent(Color.prototype, 'v');
	Object.defineProperty(Color.prototype, 'a', {
	  get: function get$$1() {
	    return this.__state.a;
	  },
	  set: function set$$1(v) {
	    this.__state.a = v;
	  }
	});
	Object.defineProperty(Color.prototype, 'hex', {
	  get: function get$$1() {
	    if (this.__state.space !== 'HEX') {
	      this.__state.hex = ColorMath.rgb_to_hex(this.r, this.g, this.b);
	      this.__state.space = 'HEX';
	    }
	    return this.__state.hex;
	  },
	  set: function set$$1(v) {
	    this.__state.space = 'HEX';
	    this.__state.hex = v;
	  }
	});

	var Controller = function () {
	  function Controller(object, property) {
	    classCallCheck(this, Controller);
	    this.initialValue = object[property];
	    this.domElement = document.createElement('div');
	    this.object = object;
	    this.property = property;
	    this.__onChange = undefined;
	    this.__onFinishChange = undefined;
	  }
	  createClass(Controller, [{
	    key: 'onChange',
	    value: function onChange(fnc) {
	      this.__onChange = fnc;
	      return this;
	    }
	  }, {
	    key: 'onFinishChange',
	    value: function onFinishChange(fnc) {
	      this.__onFinishChange = fnc;
	      return this;
	    }
	  }, {
	    key: 'setValue',
	    value: function setValue(newValue) {
	      this.object[this.property] = newValue;
	      if (this.__onChange) {
	        this.__onChange.call(this, newValue);
	      }
	      this.updateDisplay();
	      return this;
	    }
	  }, {
	    key: 'getValue',
	    value: function getValue() {
	      return this.object[this.property];
	    }
	  }, {
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      return this;
	    }
	  }, {
	    key: 'isModified',
	    value: function isModified() {
	      return this.initialValue !== this.getValue();
	    }
	  }]);
	  return Controller;
	}();

	var EVENT_MAP = {
	  HTMLEvents: ['change'],
	  MouseEvents: ['click', 'mousemove', 'mousedown', 'mouseup', 'mouseover'],
	  KeyboardEvents: ['keydown']
	};
	var EVENT_MAP_INV = {};
	Common.each(EVENT_MAP, function (v, k) {
	  Common.each(v, function (e) {
	    EVENT_MAP_INV[e] = k;
	  });
	});
	var CSS_VALUE_PIXELS = /(\d+(\.\d+)?)px/;
	function cssValueToPixels(val) {
	  if (val === '0' || Common.isUndefined(val)) {
	    return 0;
	  }
	  var match = val.match(CSS_VALUE_PIXELS);
	  if (!Common.isNull(match)) {
	    return parseFloat(match[1]);
	  }
	  return 0;
	}
	var dom = {
	  makeSelectable: function makeSelectable(elem, selectable) {
	    if (elem === undefined || elem.style === undefined) return;
	    elem.onselectstart = selectable ? function () {
	      return false;
	    } : function () {};
	    elem.style.MozUserSelect = selectable ? 'auto' : 'none';
	    elem.style.KhtmlUserSelect = selectable ? 'auto' : 'none';
	    elem.unselectable = selectable ? 'on' : 'off';
	  },
	  makeFullscreen: function makeFullscreen(elem, hor, vert) {
	    var vertical = vert;
	    var horizontal = hor;
	    if (Common.isUndefined(horizontal)) {
	      horizontal = true;
	    }
	    if (Common.isUndefined(vertical)) {
	      vertical = true;
	    }
	    elem.style.position = 'absolute';
	    if (horizontal) {
	      elem.style.left = 0;
	      elem.style.right = 0;
	    }
	    if (vertical) {
	      elem.style.top = 0;
	      elem.style.bottom = 0;
	    }
	  },
	  fakeEvent: function fakeEvent(elem, eventType, pars, aux) {
	    var params = pars || {};
	    var className = EVENT_MAP_INV[eventType];
	    if (!className) {
	      throw new Error('Event type ' + eventType + ' not supported.');
	    }
	    var evt = document.createEvent(className);
	    switch (className) {
	      case 'MouseEvents':
	        {
	          var clientX = params.x || params.clientX || 0;
	          var clientY = params.y || params.clientY || 0;
	          evt.initMouseEvent(eventType, params.bubbles || false, params.cancelable || true, window, params.clickCount || 1, 0,
	          0,
	          clientX,
	          clientY,
	          false, false, false, false, 0, null);
	          break;
	        }
	      case 'KeyboardEvents':
	        {
	          var init = evt.initKeyboardEvent || evt.initKeyEvent;
	          Common.defaults(params, {
	            cancelable: true,
	            ctrlKey: false,
	            altKey: false,
	            shiftKey: false,
	            metaKey: false,
	            keyCode: undefined,
	            charCode: undefined
	          });
	          init(eventType, params.bubbles || false, params.cancelable, window, params.ctrlKey, params.altKey, params.shiftKey, params.metaKey, params.keyCode, params.charCode);
	          break;
	        }
	      default:
	        {
	          evt.initEvent(eventType, params.bubbles || false, params.cancelable || true);
	          break;
	        }
	    }
	    Common.defaults(evt, aux);
	    elem.dispatchEvent(evt);
	  },
	  bind: function bind(elem, event, func, newBool) {
	    var bool = newBool || false;
	    if (elem.addEventListener) {
	      elem.addEventListener(event, func, bool);
	    } else if (elem.attachEvent) {
	      elem.attachEvent('on' + event, func);
	    }
	    return dom;
	  },
	  unbind: function unbind(elem, event, func, newBool) {
	    var bool = newBool || false;
	    if (elem.removeEventListener) {
	      elem.removeEventListener(event, func, bool);
	    } else if (elem.detachEvent) {
	      elem.detachEvent('on' + event, func);
	    }
	    return dom;
	  },
	  addClass: function addClass(elem, className) {
	    if (elem.className === undefined) {
	      elem.className = className;
	    } else if (elem.className !== className) {
	      var classes = elem.className.split(/ +/);
	      if (classes.indexOf(className) === -1) {
	        classes.push(className);
	        elem.className = classes.join(' ').replace(/^\s+/, '').replace(/\s+$/, '');
	      }
	    }
	    return dom;
	  },
	  removeClass: function removeClass(elem, className) {
	    if (className) {
	      if (elem.className === className) {
	        elem.removeAttribute('class');
	      } else {
	        var classes = elem.className.split(/ +/);
	        var index = classes.indexOf(className);
	        if (index !== -1) {
	          classes.splice(index, 1);
	          elem.className = classes.join(' ');
	        }
	      }
	    } else {
	      elem.className = undefined;
	    }
	    return dom;
	  },
	  hasClass: function hasClass(elem, className) {
	    return new RegExp('(?:^|\\s+)' + className + '(?:\\s+|$)').test(elem.className) || false;
	  },
	  getWidth: function getWidth(elem) {
	    var style = getComputedStyle(elem);
	    return cssValueToPixels(style['border-left-width']) + cssValueToPixels(style['border-right-width']) + cssValueToPixels(style['padding-left']) + cssValueToPixels(style['padding-right']) + cssValueToPixels(style.width);
	  },
	  getHeight: function getHeight(elem) {
	    var style = getComputedStyle(elem);
	    return cssValueToPixels(style['border-top-width']) + cssValueToPixels(style['border-bottom-width']) + cssValueToPixels(style['padding-top']) + cssValueToPixels(style['padding-bottom']) + cssValueToPixels(style.height);
	  },
	  getOffset: function getOffset(el) {
	    var elem = el;
	    var offset = { left: 0, top: 0 };
	    if (elem.offsetParent) {
	      do {
	        offset.left += elem.offsetLeft;
	        offset.top += elem.offsetTop;
	        elem = elem.offsetParent;
	      } while (elem);
	    }
	    return offset;
	  },
	  isActive: function isActive(elem) {
	    return elem === document.activeElement && (elem.type || elem.href);
	  }
	};

	var BooleanController = function (_Controller) {
	  inherits(BooleanController, _Controller);
	  function BooleanController(object, property) {
	    classCallCheck(this, BooleanController);
	    var _this2 = possibleConstructorReturn(this, (BooleanController.__proto__ || Object.getPrototypeOf(BooleanController)).call(this, object, property));
	    var _this = _this2;
	    _this2.__prev = _this2.getValue();
	    _this2.__checkbox = document.createElement('input');
	    _this2.__checkbox.setAttribute('type', 'checkbox');
	    function onChange() {
	      _this.setValue(!_this.__prev);
	    }
	    dom.bind(_this2.__checkbox, 'change', onChange, false);
	    _this2.domElement.appendChild(_this2.__checkbox);
	    _this2.updateDisplay();
	    return _this2;
	  }
	  createClass(BooleanController, [{
	    key: 'setValue',
	    value: function setValue(v) {
	      var toReturn = get(BooleanController.prototype.__proto__ || Object.getPrototypeOf(BooleanController.prototype), 'setValue', this).call(this, v);
	      if (this.__onFinishChange) {
	        this.__onFinishChange.call(this, this.getValue());
	      }
	      this.__prev = this.getValue();
	      return toReturn;
	    }
	  }, {
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      if (this.getValue() === true) {
	        this.__checkbox.setAttribute('checked', 'checked');
	        this.__checkbox.checked = true;
	        this.__prev = true;
	      } else {
	        this.__checkbox.checked = false;
	        this.__prev = false;
	      }
	      return get(BooleanController.prototype.__proto__ || Object.getPrototypeOf(BooleanController.prototype), 'updateDisplay', this).call(this);
	    }
	  }]);
	  return BooleanController;
	}(Controller);

	var OptionController = function (_Controller) {
	  inherits(OptionController, _Controller);
	  function OptionController(object, property, opts) {
	    classCallCheck(this, OptionController);
	    var _this2 = possibleConstructorReturn(this, (OptionController.__proto__ || Object.getPrototypeOf(OptionController)).call(this, object, property));
	    var options = opts;
	    var _this = _this2;
	    _this2.__select = document.createElement('select');
	    if (Common.isArray(options)) {
	      var map = {};
	      Common.each(options, function (element) {
	        map[element] = element;
	      });
	      options = map;
	    }
	    Common.each(options, function (value, key) {
	      var opt = document.createElement('option');
	      opt.innerHTML = key;
	      opt.setAttribute('value', value);
	      _this.__select.appendChild(opt);
	    });
	    _this2.updateDisplay();
	    dom.bind(_this2.__select, 'change', function () {
	      var desiredValue = this.options[this.selectedIndex].value;
	      _this.setValue(desiredValue);
	    });
	    _this2.domElement.appendChild(_this2.__select);
	    return _this2;
	  }
	  createClass(OptionController, [{
	    key: 'setValue',
	    value: function setValue(v) {
	      var toReturn = get(OptionController.prototype.__proto__ || Object.getPrototypeOf(OptionController.prototype), 'setValue', this).call(this, v);
	      if (this.__onFinishChange) {
	        this.__onFinishChange.call(this, this.getValue());
	      }
	      return toReturn;
	    }
	  }, {
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      if (dom.isActive(this.__select)) return this;
	      this.__select.value = this.getValue();
	      return get(OptionController.prototype.__proto__ || Object.getPrototypeOf(OptionController.prototype), 'updateDisplay', this).call(this);
	    }
	  }]);
	  return OptionController;
	}(Controller);

	var StringController = function (_Controller) {
	  inherits(StringController, _Controller);
	  function StringController(object, property) {
	    classCallCheck(this, StringController);
	    var _this2 = possibleConstructorReturn(this, (StringController.__proto__ || Object.getPrototypeOf(StringController)).call(this, object, property));
	    var _this = _this2;
	    function onChange() {
	      _this.setValue(_this.__input.value);
	    }
	    function onBlur() {
	      if (_this.__onFinishChange) {
	        _this.__onFinishChange.call(_this, _this.getValue());
	      }
	    }
	    _this2.__input = document.createElement('input');
	    _this2.__input.setAttribute('type', 'text');
	    dom.bind(_this2.__input, 'keyup', onChange);
	    dom.bind(_this2.__input, 'change', onChange);
	    dom.bind(_this2.__input, 'blur', onBlur);
	    dom.bind(_this2.__input, 'keydown', function (e) {
	      if (e.keyCode === 13) {
	        this.blur();
	      }
	    });
	    _this2.updateDisplay();
	    _this2.domElement.appendChild(_this2.__input);
	    return _this2;
	  }
	  createClass(StringController, [{
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      if (!dom.isActive(this.__input)) {
	        this.__input.value = this.getValue();
	      }
	      return get(StringController.prototype.__proto__ || Object.getPrototypeOf(StringController.prototype), 'updateDisplay', this).call(this);
	    }
	  }]);
	  return StringController;
	}(Controller);

	function numDecimals(x) {
	  var _x = x.toString();
	  if (_x.indexOf('.') > -1) {
	    return _x.length - _x.indexOf('.') - 1;
	  }
	  return 0;
	}
	var NumberController = function (_Controller) {
	  inherits(NumberController, _Controller);
	  function NumberController(object, property, params) {
	    classCallCheck(this, NumberController);
	    var _this = possibleConstructorReturn(this, (NumberController.__proto__ || Object.getPrototypeOf(NumberController)).call(this, object, property));
	    var _params = params || {};
	    _this.__min = _params.min;
	    _this.__max = _params.max;
	    _this.__step = _params.step;
	    if (Common.isUndefined(_this.__step)) {
	      if (_this.initialValue === 0) {
	        _this.__impliedStep = 1;
	      } else {
	        _this.__impliedStep = Math.pow(10, Math.floor(Math.log(Math.abs(_this.initialValue)) / Math.LN10)) / 10;
	      }
	    } else {
	      _this.__impliedStep = _this.__step;
	    }
	    _this.__precision = numDecimals(_this.__impliedStep);
	    return _this;
	  }
	  createClass(NumberController, [{
	    key: 'setValue',
	    value: function setValue(v) {
	      var _v = v;
	      if (this.__min !== undefined && _v < this.__min) {
	        _v = this.__min;
	      } else if (this.__max !== undefined && _v > this.__max) {
	        _v = this.__max;
	      }
	      if (this.__step !== undefined && _v % this.__step !== 0) {
	        _v = Math.round(_v / this.__step) * this.__step;
	      }
	      return get(NumberController.prototype.__proto__ || Object.getPrototypeOf(NumberController.prototype), 'setValue', this).call(this, _v);
	    }
	  }, {
	    key: 'min',
	    value: function min(minValue) {
	      this.__min = minValue;
	      return this;
	    }
	  }, {
	    key: 'max',
	    value: function max(maxValue) {
	      this.__max = maxValue;
	      return this;
	    }
	  }, {
	    key: 'step',
	    value: function step(stepValue) {
	      this.__step = stepValue;
	      this.__impliedStep = stepValue;
	      this.__precision = numDecimals(stepValue);
	      return this;
	    }
	  }]);
	  return NumberController;
	}(Controller);

	function roundToDecimal(value, decimals) {
	  var tenTo = Math.pow(10, decimals);
	  return Math.round(value * tenTo) / tenTo;
	}
	var NumberControllerBox = function (_NumberController) {
	  inherits(NumberControllerBox, _NumberController);
	  function NumberControllerBox(object, property, params) {
	    classCallCheck(this, NumberControllerBox);
	    var _this2 = possibleConstructorReturn(this, (NumberControllerBox.__proto__ || Object.getPrototypeOf(NumberControllerBox)).call(this, object, property, params));
	    _this2.__truncationSuspended = false;
	    var _this = _this2;
	    var prevY = void 0;
	    function onChange() {
	      var attempted = parseFloat(_this.__input.value);
	      if (!Common.isNaN(attempted)) {
	        _this.setValue(attempted);
	      }
	    }
	    function onFinish() {
	      if (_this.__onFinishChange) {
	        _this.__onFinishChange.call(_this, _this.getValue());
	      }
	    }
	    function onBlur() {
	      onFinish();
	    }
	    function onMouseDrag(e) {
	      var diff = prevY - e.clientY;
	      _this.setValue(_this.getValue() + diff * _this.__impliedStep);
	      prevY = e.clientY;
	    }
	    function onMouseUp() {
	      dom.unbind(window, 'mousemove', onMouseDrag);
	      dom.unbind(window, 'mouseup', onMouseUp);
	      onFinish();
	    }
	    function onMouseDown(e) {
	      dom.bind(window, 'mousemove', onMouseDrag);
	      dom.bind(window, 'mouseup', onMouseUp);
	      prevY = e.clientY;
	    }
	    _this2.__input = document.createElement('input');
	    _this2.__input.setAttribute('type', 'text');
	    dom.bind(_this2.__input, 'change', onChange);
	    dom.bind(_this2.__input, 'blur', onBlur);
	    dom.bind(_this2.__input, 'mousedown', onMouseDown);
	    dom.bind(_this2.__input, 'keydown', function (e) {
	      if (e.keyCode === 13) {
	        _this.__truncationSuspended = true;
	        this.blur();
	        _this.__truncationSuspended = false;
	        onFinish();
	      }
	    });
	    _this2.updateDisplay();
	    _this2.domElement.appendChild(_this2.__input);
	    return _this2;
	  }
	  createClass(NumberControllerBox, [{
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      this.__input.value = this.__truncationSuspended ? this.getValue() : roundToDecimal(this.getValue(), this.__precision);
	      return get(NumberControllerBox.prototype.__proto__ || Object.getPrototypeOf(NumberControllerBox.prototype), 'updateDisplay', this).call(this);
	    }
	  }]);
	  return NumberControllerBox;
	}(NumberController);

	function map(v, i1, i2, o1, o2) {
	  return o1 + (o2 - o1) * ((v - i1) / (i2 - i1));
	}
	var NumberControllerSlider = function (_NumberController) {
	  inherits(NumberControllerSlider, _NumberController);
	  function NumberControllerSlider(object, property, min, max, step) {
	    classCallCheck(this, NumberControllerSlider);
	    var _this2 = possibleConstructorReturn(this, (NumberControllerSlider.__proto__ || Object.getPrototypeOf(NumberControllerSlider)).call(this, object, property, { min: min, max: max, step: step }));
	    var _this = _this2;
	    _this2.__background = document.createElement('div');
	    _this2.__foreground = document.createElement('div');
	    dom.bind(_this2.__background, 'mousedown', onMouseDown);
	    dom.bind(_this2.__background, 'touchstart', onTouchStart);
	    dom.addClass(_this2.__background, 'slider');
	    dom.addClass(_this2.__foreground, 'slider-fg');
	    function onMouseDown(e) {
	      document.activeElement.blur();
	      dom.bind(window, 'mousemove', onMouseDrag);
	      dom.bind(window, 'mouseup', onMouseUp);
	      onMouseDrag(e);
	    }
	    function onMouseDrag(e) {
	      e.preventDefault();
	      var bgRect = _this.__background.getBoundingClientRect();
	      _this.setValue(map(e.clientX, bgRect.left, bgRect.right, _this.__min, _this.__max));
	      return false;
	    }
	    function onMouseUp() {
	      dom.unbind(window, 'mousemove', onMouseDrag);
	      dom.unbind(window, 'mouseup', onMouseUp);
	      if (_this.__onFinishChange) {
	        _this.__onFinishChange.call(_this, _this.getValue());
	      }
	    }
	    function onTouchStart(e) {
	      if (e.touches.length !== 1) {
	        return;
	      }
	      dom.bind(window, 'touchmove', onTouchMove);
	      dom.bind(window, 'touchend', onTouchEnd);
	      onTouchMove(e);
	    }
	    function onTouchMove(e) {
	      var clientX = e.touches[0].clientX;
	      var bgRect = _this.__background.getBoundingClientRect();
	      _this.setValue(map(clientX, bgRect.left, bgRect.right, _this.__min, _this.__max));
	    }
	    function onTouchEnd() {
	      dom.unbind(window, 'touchmove', onTouchMove);
	      dom.unbind(window, 'touchend', onTouchEnd);
	      if (_this.__onFinishChange) {
	        _this.__onFinishChange.call(_this, _this.getValue());
	      }
	    }
	    _this2.updateDisplay();
	    _this2.__background.appendChild(_this2.__foreground);
	    _this2.domElement.appendChild(_this2.__background);
	    return _this2;
	  }
	  createClass(NumberControllerSlider, [{
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      var pct = (this.getValue() - this.__min) / (this.__max - this.__min);
	      this.__foreground.style.width = pct * 100 + '%';
	      return get(NumberControllerSlider.prototype.__proto__ || Object.getPrototypeOf(NumberControllerSlider.prototype), 'updateDisplay', this).call(this);
	    }
	  }]);
	  return NumberControllerSlider;
	}(NumberController);

	var FunctionController = function (_Controller) {
	  inherits(FunctionController, _Controller);
	  function FunctionController(object, property, text) {
	    classCallCheck(this, FunctionController);
	    var _this2 = possibleConstructorReturn(this, (FunctionController.__proto__ || Object.getPrototypeOf(FunctionController)).call(this, object, property));
	    var _this = _this2;
	    _this2.__button = document.createElement('div');
	    _this2.__button.innerHTML = text === undefined ? 'Fire' : text;
	    dom.bind(_this2.__button, 'click', function (e) {
	      e.preventDefault();
	      _this.fire();
	      return false;
	    });
	    dom.addClass(_this2.__button, 'button');
	    _this2.domElement.appendChild(_this2.__button);
	    return _this2;
	  }
	  createClass(FunctionController, [{
	    key: 'fire',
	    value: function fire() {
	      if (this.__onChange) {
	        this.__onChange.call(this);
	      }
	      this.getValue().call(this.object);
	      if (this.__onFinishChange) {
	        this.__onFinishChange.call(this, this.getValue());
	      }
	    }
	  }]);
	  return FunctionController;
	}(Controller);

	var ColorController = function (_Controller) {
	  inherits(ColorController, _Controller);
	  function ColorController(object, property) {
	    classCallCheck(this, ColorController);
	    var _this2 = possibleConstructorReturn(this, (ColorController.__proto__ || Object.getPrototypeOf(ColorController)).call(this, object, property));
	    _this2.__color = new Color(_this2.getValue());
	    _this2.__temp = new Color(0);
	    var _this = _this2;
	    _this2.domElement = document.createElement('div');
	    dom.makeSelectable(_this2.domElement, false);
	    _this2.__selector = document.createElement('div');
	    _this2.__selector.className = 'selector';
	    _this2.__saturation_field = document.createElement('div');
	    _this2.__saturation_field.className = 'saturation-field';
	    _this2.__field_knob = document.createElement('div');
	    _this2.__field_knob.className = 'field-knob';
	    _this2.__field_knob_border = '2px solid ';
	    _this2.__hue_knob = document.createElement('div');
	    _this2.__hue_knob.className = 'hue-knob';
	    _this2.__hue_field = document.createElement('div');
	    _this2.__hue_field.className = 'hue-field';
	    _this2.__input = document.createElement('input');
	    _this2.__input.type = 'text';
	    _this2.__input_textShadow = '0 1px 1px ';
	    dom.bind(_this2.__input, 'keydown', function (e) {
	      if (e.keyCode === 13) {
	        onBlur.call(this);
	      }
	    });
	    dom.bind(_this2.__input, 'blur', onBlur);
	    dom.bind(_this2.__selector, 'mousedown', function ()        {
	      dom.addClass(this, 'drag').bind(window, 'mouseup', function ()        {
	        dom.removeClass(_this.__selector, 'drag');
	      });
	    });
	    dom.bind(_this2.__selector, 'touchstart', function ()        {
	      dom.addClass(this, 'drag').bind(window, 'touchend', function ()        {
	        dom.removeClass(_this.__selector, 'drag');
	      });
	    });
	    var valueField = document.createElement('div');
	    Common.extend(_this2.__selector.style, {
	      width: '122px',
	      height: '102px',
	      padding: '3px',
	      backgroundColor: '#222',
	      boxShadow: '0px 1px 3px rgba(0,0,0,0.3)'
	    });
	    Common.extend(_this2.__field_knob.style, {
	      position: 'absolute',
	      width: '12px',
	      height: '12px',
	      border: _this2.__field_knob_border + (_this2.__color.v < 0.5 ? '#fff' : '#000'),
	      boxShadow: '0px 1px 3px rgba(0,0,0,0.5)',
	      borderRadius: '12px',
	      zIndex: 1
	    });
	    Common.extend(_this2.__hue_knob.style, {
	      position: 'absolute',
	      width: '15px',
	      height: '2px',
	      borderRight: '4px solid #fff',
	      zIndex: 1
	    });
	    Common.extend(_this2.__saturation_field.style, {
	      width: '100px',
	      height: '100px',
	      border: '1px solid #555',
	      marginRight: '3px',
	      display: 'inline-block',
	      cursor: 'pointer'
	    });
	    Common.extend(valueField.style, {
	      width: '100%',
	      height: '100%',
	      background: 'none'
	    });
	    linearGradient(valueField, 'top', 'rgba(0,0,0,0)', '#000');
	    Common.extend(_this2.__hue_field.style, {
	      width: '15px',
	      height: '100px',
	      border: '1px solid #555',
	      cursor: 'ns-resize',
	      position: 'absolute',
	      top: '3px',
	      right: '3px'
	    });
	    hueGradient(_this2.__hue_field);
	    Common.extend(_this2.__input.style, {
	      outline: 'none',
	      textAlign: 'center',
	      color: '#fff',
	      border: 0,
	      fontWeight: 'bold',
	      textShadow: _this2.__input_textShadow + 'rgba(0,0,0,0.7)'
	    });
	    dom.bind(_this2.__saturation_field, 'mousedown', fieldDown);
	    dom.bind(_this2.__saturation_field, 'touchstart', fieldDown);
	    dom.bind(_this2.__field_knob, 'mousedown', fieldDown);
	    dom.bind(_this2.__field_knob, 'touchstart', fieldDown);
	    dom.bind(_this2.__hue_field, 'mousedown', fieldDownH);
	    dom.bind(_this2.__hue_field, 'touchstart', fieldDownH);
	    function fieldDown(e) {
	      setSV(e);
	      dom.bind(window, 'mousemove', setSV);
	      dom.bind(window, 'touchmove', setSV);
	      dom.bind(window, 'mouseup', fieldUpSV);
	      dom.bind(window, 'touchend', fieldUpSV);
	    }
	    function fieldDownH(e) {
	      setH(e);
	      dom.bind(window, 'mousemove', setH);
	      dom.bind(window, 'touchmove', setH);
	      dom.bind(window, 'mouseup', fieldUpH);
	      dom.bind(window, 'touchend', fieldUpH);
	    }
	    function fieldUpSV() {
	      dom.unbind(window, 'mousemove', setSV);
	      dom.unbind(window, 'touchmove', setSV);
	      dom.unbind(window, 'mouseup', fieldUpSV);
	      dom.unbind(window, 'touchend', fieldUpSV);
	      onFinish();
	    }
	    function fieldUpH() {
	      dom.unbind(window, 'mousemove', setH);
	      dom.unbind(window, 'touchmove', setH);
	      dom.unbind(window, 'mouseup', fieldUpH);
	      dom.unbind(window, 'touchend', fieldUpH);
	      onFinish();
	    }
	    function onBlur() {
	      var i = interpret(this.value);
	      if (i !== false) {
	        _this.__color.__state = i;
	        _this.setValue(_this.__color.toOriginal());
	      } else {
	        this.value = _this.__color.toString();
	      }
	    }
	    function onFinish() {
	      if (_this.__onFinishChange) {
	        _this.__onFinishChange.call(_this, _this.__color.toOriginal());
	      }
	    }
	    _this2.__saturation_field.appendChild(valueField);
	    _this2.__selector.appendChild(_this2.__field_knob);
	    _this2.__selector.appendChild(_this2.__saturation_field);
	    _this2.__selector.appendChild(_this2.__hue_field);
	    _this2.__hue_field.appendChild(_this2.__hue_knob);
	    _this2.domElement.appendChild(_this2.__input);
	    _this2.domElement.appendChild(_this2.__selector);
	    _this2.updateDisplay();
	    function setSV(e) {
	      if (e.type.indexOf('touch') === -1) {
	        e.preventDefault();
	      }
	      var fieldRect = _this.__saturation_field.getBoundingClientRect();
	      var _ref = e.touches && e.touches[0] || e,
	          clientX = _ref.clientX,
	          clientY = _ref.clientY;
	      var s = (clientX - fieldRect.left) / (fieldRect.right - fieldRect.left);
	      var v = 1 - (clientY - fieldRect.top) / (fieldRect.bottom - fieldRect.top);
	      if (v > 1) {
	        v = 1;
	      } else if (v < 0) {
	        v = 0;
	      }
	      if (s > 1) {
	        s = 1;
	      } else if (s < 0) {
	        s = 0;
	      }
	      _this.__color.v = v;
	      _this.__color.s = s;
	      _this.setValue(_this.__color.toOriginal());
	      return false;
	    }
	    function setH(e) {
	      if (e.type.indexOf('touch') === -1) {
	        e.preventDefault();
	      }
	      var fieldRect = _this.__hue_field.getBoundingClientRect();
	      var _ref2 = e.touches && e.touches[0] || e,
	          clientY = _ref2.clientY;
	      var h = 1 - (clientY - fieldRect.top) / (fieldRect.bottom - fieldRect.top);
	      if (h > 1) {
	        h = 1;
	      } else if (h < 0) {
	        h = 0;
	      }
	      _this.__color.h = h * 360;
	      _this.setValue(_this.__color.toOriginal());
	      return false;
	    }
	    return _this2;
	  }
	  createClass(ColorController, [{
	    key: 'updateDisplay',
	    value: function updateDisplay() {
	      var i = interpret(this.getValue());
	      if (i !== false) {
	        var mismatch = false;
	        Common.each(Color.COMPONENTS, function (component) {
	          if (!Common.isUndefined(i[component]) && !Common.isUndefined(this.__color.__state[component]) && i[component] !== this.__color.__state[component]) {
	            mismatch = true;
	            return {};
	          }
	        }, this);
	        if (mismatch) {
	          Common.extend(this.__color.__state, i);
	        }
	      }
	      Common.extend(this.__temp.__state, this.__color.__state);
	      this.__temp.a = 1;
	      var flip = this.__color.v < 0.5 || this.__color.s > 0.5 ? 255 : 0;
	      var _flip = 255 - flip;
	      Common.extend(this.__field_knob.style, {
	        marginLeft: 100 * this.__color.s - 7 + 'px',
	        marginTop: 100 * (1 - this.__color.v) - 7 + 'px',
	        backgroundColor: this.__temp.toHexString(),
	        border: this.__field_knob_border + 'rgb(' + flip + ',' + flip + ',' + flip + ')'
	      });
	      this.__hue_knob.style.marginTop = (1 - this.__color.h / 360) * 100 + 'px';
	      this.__temp.s = 1;
	      this.__temp.v = 1;
	      linearGradient(this.__saturation_field, 'left', '#fff', this.__temp.toHexString());
	      this.__input.value = this.__color.toString();
	      Common.extend(this.__input.style, {
	        backgroundColor: this.__color.toHexString(),
	        color: 'rgb(' + flip + ',' + flip + ',' + flip + ')',
	        textShadow: this.__input_textShadow + 'rgba(' + _flip + ',' + _flip + ',' + _flip + ',.7)'
	      });
	    }
	  }]);
	  return ColorController;
	}(Controller);
	var vendors = ['-moz-', '-o-', '-webkit-', '-ms-', ''];
	function linearGradient(elem, x, a, b) {
	  elem.style.background = '';
	  Common.each(vendors, function (vendor) {
	    elem.style.cssText += 'background: ' + vendor + 'linear-gradient(' + x + ', ' + a + ' 0%, ' + b + ' 100%); ';
	  });
	}
	function hueGradient(elem) {
	  elem.style.background = '';
	  elem.style.cssText += 'background: -moz-linear-gradient(top,  #ff0000 0%, #ff00ff 17%, #0000ff 34%, #00ffff 50%, #00ff00 67%, #ffff00 84%, #ff0000 100%);';
	  elem.style.cssText += 'background: -webkit-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);';
	  elem.style.cssText += 'background: -o-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);';
	  elem.style.cssText += 'background: -ms-linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);';
	  elem.style.cssText += 'background: linear-gradient(top,  #ff0000 0%,#ff00ff 17%,#0000ff 34%,#00ffff 50%,#00ff00 67%,#ffff00 84%,#ff0000 100%);';
	}

	var css = {
	  load: function load(url, indoc) {
	    var doc = indoc || document;
	    var link = doc.createElement('link');
	    link.type = 'text/css';
	    link.rel = 'stylesheet';
	    link.href = url;
	    doc.getElementsByTagName('head')[0].appendChild(link);
	  },
	  inject: function inject(cssContent, indoc) {
	    var doc = indoc || document;
	    var injected = document.createElement('style');
	    injected.type = 'text/css';
	    injected.innerHTML = cssContent;
	    var head = doc.getElementsByTagName('head')[0];
	    try {
	      head.appendChild(injected);
	    } catch (e) {
	    }
	  }
	};

	var saveDialogContents = "<div id=\"dg-save\" class=\"dg dialogue\">\n\n  Here's the new load parameter for your <code>GUI</code>'s constructor:\n\n  <textarea id=\"dg-new-constructor\"></textarea>\n\n  <div id=\"dg-save-locally\">\n\n    <input id=\"dg-local-storage\" type=\"checkbox\"/> Automatically save\n    values to <code>localStorage</code> on exit.\n\n    <div id=\"dg-local-explain\">The values saved to <code>localStorage</code> will\n      override those passed to <code>dat.GUI</code>'s constructor. This makes it\n      easier to work incrementally, but <code>localStorage</code> is fragile,\n      and your friends may not see the same values you do.\n\n    </div>\n\n  </div>\n\n</div>";

	var ControllerFactory = function ControllerFactory(object, property) {
	  var initialValue = object[property];
	  if (Common.isArray(arguments[2]) || Common.isObject(arguments[2])) {
	    return new OptionController(object, property, arguments[2]);
	  }
	  if (Common.isNumber(initialValue)) {
	    if (Common.isNumber(arguments[2]) && Common.isNumber(arguments[3])) {
	      if (Common.isNumber(arguments[4])) {
	        return new NumberControllerSlider(object, property, arguments[2], arguments[3], arguments[4]);
	      }
	      return new NumberControllerSlider(object, property, arguments[2], arguments[3]);
	    }
	    if (Common.isNumber(arguments[4])) {
	      return new NumberControllerBox(object, property, { min: arguments[2], max: arguments[3], step: arguments[4] });
	    }
	    return new NumberControllerBox(object, property, { min: arguments[2], max: arguments[3] });
	  }
	  if (Common.isString(initialValue)) {
	    return new StringController(object, property);
	  }
	  if (Common.isFunction(initialValue)) {
	    return new FunctionController(object, property, '');
	  }
	  if (Common.isBoolean(initialValue)) {
	    return new BooleanController(object, property);
	  }
	  return null;
	};

	function requestAnimationFrame$1(callback) {
	  setTimeout(callback, 1000 / 60);
	}
	var requestAnimationFrame$1$1 = window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame || window.oRequestAnimationFrame || window.msRequestAnimationFrame || requestAnimationFrame$1;

	var CenteredDiv = function () {
	  function CenteredDiv() {
	    classCallCheck(this, CenteredDiv);
	    this.backgroundElement = document.createElement('div');
	    Common.extend(this.backgroundElement.style, {
	      backgroundColor: 'rgba(0,0,0,0.8)',
	      top: 0,
	      left: 0,
	      display: 'none',
	      zIndex: '1000',
	      opacity: 0,
	      WebkitTransition: 'opacity 0.2s linear',
	      transition: 'opacity 0.2s linear'
	    });
	    dom.makeFullscreen(this.backgroundElement);
	    this.backgroundElement.style.position = 'fixed';
	    this.domElement = document.createElement('div');
	    Common.extend(this.domElement.style, {
	      position: 'fixed',
	      display: 'none',
	      zIndex: '1001',
	      opacity: 0,
	      WebkitTransition: '-webkit-transform 0.2s ease-out, opacity 0.2s linear',
	      transition: 'transform 0.2s ease-out, opacity 0.2s linear'
	    });
	    document.body.appendChild(this.backgroundElement);
	    document.body.appendChild(this.domElement);
	    var _this = this;
	    dom.bind(this.backgroundElement, 'click', function () {
	      _this.hide();
	    });
	  }
	  createClass(CenteredDiv, [{
	    key: 'show',
	    value: function show() {
	      var _this = this;
	      this.backgroundElement.style.display = 'block';
	      this.domElement.style.display = 'block';
	      this.domElement.style.opacity = 0;
	      this.domElement.style.webkitTransform = 'scale(1.1)';
	      this.layout();
	      Common.defer(function () {
	        _this.backgroundElement.style.opacity = 1;
	        _this.domElement.style.opacity = 1;
	        _this.domElement.style.webkitTransform = 'scale(1)';
	      });
	    }
	  }, {
	    key: 'hide',
	    value: function hide() {
	      var _this = this;
	      var hide = function hide() {
	        _this.domElement.style.display = 'none';
	        _this.backgroundElement.style.display = 'none';
	        dom.unbind(_this.domElement, 'webkitTransitionEnd', hide);
	        dom.unbind(_this.domElement, 'transitionend', hide);
	        dom.unbind(_this.domElement, 'oTransitionEnd', hide);
	      };
	      dom.bind(this.domElement, 'webkitTransitionEnd', hide);
	      dom.bind(this.domElement, 'transitionend', hide);
	      dom.bind(this.domElement, 'oTransitionEnd', hide);
	      this.backgroundElement.style.opacity = 0;
	      this.domElement.style.opacity = 0;
	      this.domElement.style.webkitTransform = 'scale(1.1)';
	    }
	  }, {
	    key: 'layout',
	    value: function layout() {
	      this.domElement.style.left = window.innerWidth / 2 - dom.getWidth(this.domElement) / 2 + 'px';
	      this.domElement.style.top = window.innerHeight / 2 - dom.getHeight(this.domElement) / 2 + 'px';
	    }
	  }]);
	  return CenteredDiv;
	}();

	var styleSheet = ___$insertStyle(".dg ul{list-style:none;margin:0;padding:0;width:100%;clear:both}.dg.ac{position:fixed;top:0;left:0;right:0;height:0;z-index:0}.dg:not(.ac) .main{overflow:hidden}.dg.main{-webkit-transition:opacity .1s linear;-o-transition:opacity .1s linear;-moz-transition:opacity .1s linear;transition:opacity .1s linear}.dg.main.taller-than-window{overflow-y:auto}.dg.main.taller-than-window .close-button{opacity:1;margin-top:-1px;border-top:1px solid #2c2c2c}.dg.main ul.closed .close-button{opacity:1 !important}.dg.main:hover .close-button,.dg.main .close-button.drag{opacity:1}.dg.main .close-button{-webkit-transition:opacity .1s linear;-o-transition:opacity .1s linear;-moz-transition:opacity .1s linear;transition:opacity .1s linear;border:0;line-height:19px;height:20px;cursor:pointer;text-align:center;background-color:#000}.dg.main .close-button.close-top{position:relative}.dg.main .close-button.close-bottom{position:absolute}.dg.main .close-button:hover{background-color:#111}.dg.a{float:right;margin-right:15px;overflow-y:visible}.dg.a.has-save>ul.close-top{margin-top:0}.dg.a.has-save>ul.close-bottom{margin-top:27px}.dg.a.has-save>ul.closed{margin-top:0}.dg.a .save-row{top:0;z-index:1002}.dg.a .save-row.close-top{position:relative}.dg.a .save-row.close-bottom{position:fixed}.dg li{-webkit-transition:height .1s ease-out;-o-transition:height .1s ease-out;-moz-transition:height .1s ease-out;transition:height .1s ease-out;-webkit-transition:overflow .1s linear;-o-transition:overflow .1s linear;-moz-transition:overflow .1s linear;transition:overflow .1s linear}.dg li:not(.folder){cursor:auto;height:27px;line-height:27px;padding:0 4px 0 5px}.dg li.folder{padding:0;border-left:4px solid rgba(0,0,0,0)}.dg li.title{cursor:pointer;margin-left:-4px}.dg .closed li:not(.title),.dg .closed ul li,.dg .closed ul li>*{height:0;overflow:hidden;border:0}.dg .cr{clear:both;padding-left:3px;height:27px;overflow:hidden}.dg .property-name{cursor:default;float:left;clear:left;width:40%;overflow:hidden;text-overflow:ellipsis}.dg .c{float:left;width:60%;position:relative}.dg .c input[type=text]{border:0;margin-top:4px;padding:3px;width:100%;float:right}.dg .has-slider input[type=text]{width:30%;margin-left:0}.dg .slider{float:left;width:66%;margin-left:-5px;margin-right:0;height:19px;margin-top:4px}.dg .slider-fg{height:100%}.dg .c input[type=checkbox]{margin-top:7px}.dg .c select{margin-top:5px}.dg .cr.function,.dg .cr.function .property-name,.dg .cr.function *,.dg .cr.boolean,.dg .cr.boolean *{cursor:pointer}.dg .cr.color{overflow:visible}.dg .selector{display:none;position:absolute;margin-left:-9px;margin-top:23px;z-index:10}.dg .c:hover .selector,.dg .selector.drag{display:block}.dg li.save-row{padding:0}.dg li.save-row .button{display:inline-block;padding:0px 6px}.dg.dialogue{background-color:#222;width:460px;padding:15px;font-size:13px;line-height:15px}#dg-new-constructor{padding:10px;color:#222;font-family:Monaco, monospace;font-size:10px;border:0;resize:none;box-shadow:inset 1px 1px 1px #888;word-wrap:break-word;margin:12px 0;display:block;width:440px;overflow-y:scroll;height:100px;position:relative}#dg-local-explain{display:none;font-size:11px;line-height:17px;border-radius:3px;background-color:#333;padding:8px;margin-top:10px}#dg-local-explain code{font-size:10px}#dat-gui-save-locally{display:none}.dg{color:#eee;font:11px 'Lucida Grande', sans-serif;text-shadow:0 -1px 0 #111}.dg.main::-webkit-scrollbar{width:5px;background:#1a1a1a}.dg.main::-webkit-scrollbar-corner{height:0;display:none}.dg.main::-webkit-scrollbar-thumb{border-radius:5px;background:#676767}.dg li:not(.folder){background:#1a1a1a;border-bottom:1px solid #2c2c2c}.dg li.save-row{line-height:25px;background:#dad5cb;border:0}.dg li.save-row select{margin-left:5px;width:108px}.dg li.save-row .button{margin-left:5px;margin-top:1px;border-radius:2px;font-size:9px;line-height:7px;padding:4px 4px 5px 4px;background:#c5bdad;color:#fff;text-shadow:0 1px 0 #b0a58f;box-shadow:0 -1px 0 #b0a58f;cursor:pointer}.dg li.save-row .button.gears{background:#c5bdad url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAANCAYAAAB/9ZQ7AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAQJJREFUeNpiYKAU/P//PwGIC/ApCABiBSAW+I8AClAcgKxQ4T9hoMAEUrxx2QSGN6+egDX+/vWT4e7N82AMYoPAx/evwWoYoSYbACX2s7KxCxzcsezDh3evFoDEBYTEEqycggWAzA9AuUSQQgeYPa9fPv6/YWm/Acx5IPb7ty/fw+QZblw67vDs8R0YHyQhgObx+yAJkBqmG5dPPDh1aPOGR/eugW0G4vlIoTIfyFcA+QekhhHJhPdQxbiAIguMBTQZrPD7108M6roWYDFQiIAAv6Aow/1bFwXgis+f2LUAynwoIaNcz8XNx3Dl7MEJUDGQpx9gtQ8YCueB+D26OECAAQDadt7e46D42QAAAABJRU5ErkJggg==) 2px 1px no-repeat;height:7px;width:8px}.dg li.save-row .button:hover{background-color:#bab19e;box-shadow:0 -1px 0 #b0a58f}.dg li.folder{border-bottom:0}.dg li.title{padding-left:16px;background:#000 url(data:image/gif;base64,R0lGODlhBQAFAJEAAP////Pz8////////yH5BAEAAAIALAAAAAAFAAUAAAIIlI+hKgFxoCgAOw==) 6px 10px no-repeat;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.2)}.dg .closed li.title{background-image:url(data:image/gif;base64,R0lGODlhBQAFAJEAAP////Pz8////////yH5BAEAAAIALAAAAAAFAAUAAAIIlGIWqMCbWAEAOw==)}.dg .cr.boolean{border-left:3px solid #806787}.dg .cr.color{border-left:3px solid}.dg .cr.function{border-left:3px solid #e61d5f}.dg .cr.number{border-left:3px solid #2FA1D6}.dg .cr.number input[type=text]{color:#2FA1D6}.dg .cr.string{border-left:3px solid #1ed36f}.dg .cr.string input[type=text]{color:#1ed36f}.dg .cr.function:hover,.dg .cr.boolean:hover{background:#111}.dg .c input[type=text]{background:#303030;outline:none}.dg .c input[type=text]:hover{background:#3c3c3c}.dg .c input[type=text]:focus{background:#494949;color:#fff}.dg .c .slider{background:#303030;cursor:ew-resize}.dg .c .slider-fg{background:#2FA1D6;max-width:100%}.dg .c .slider:hover{background:#3c3c3c}.dg .c .slider:hover .slider-fg{background:#44abda}\n");

	css.inject(styleSheet);
	var CSS_NAMESPACE = 'dg';
	var HIDE_KEY_CODE = 72;
	var CLOSE_BUTTON_HEIGHT = 20;
	var DEFAULT_DEFAULT_PRESET_NAME = 'Default';
	var SUPPORTS_LOCAL_STORAGE = function () {
	  try {
	    return !!window.localStorage;
	  } catch (e) {
	    return false;
	  }
	}();
	var SAVE_DIALOGUE = void 0;
	var autoPlaceVirgin = true;
	var autoPlaceContainer = void 0;
	var hide = false;
	var hideableGuis = [];
	var GUI = function GUI(pars) {
	  var _this = this;
	  var params = pars || {};
	  this.domElement = document.createElement('div');
	  this.__ul = document.createElement('ul');
	  this.domElement.appendChild(this.__ul);
	  dom.addClass(this.domElement, CSS_NAMESPACE);
	  this.__folders = {};
	  this.__controllers = [];
	  this.__rememberedObjects = [];
	  this.__rememberedObjectIndecesToControllers = [];
	  this.__listening = [];
	  params = Common.defaults(params, {
	    closeOnTop: false,
	    autoPlace: true,
	    width: GUI.DEFAULT_WIDTH
	  });
	  params = Common.defaults(params, {
	    resizable: params.autoPlace,
	    hideable: params.autoPlace
	  });
	  if (!Common.isUndefined(params.load)) {
	    if (params.preset) {
	      params.load.preset = params.preset;
	    }
	  } else {
	    params.load = { preset: DEFAULT_DEFAULT_PRESET_NAME };
	  }
	  if (Common.isUndefined(params.parent) && params.hideable) {
	    hideableGuis.push(this);
	  }
	  params.resizable = Common.isUndefined(params.parent) && params.resizable;
	  if (params.autoPlace && Common.isUndefined(params.scrollable)) {
	    params.scrollable = true;
	  }
	  var useLocalStorage = SUPPORTS_LOCAL_STORAGE && localStorage.getItem(getLocalStorageHash(this, 'isLocal')) === 'true';
	  var saveToLocalStorage = void 0;
	  var titleRow = void 0;
	  Object.defineProperties(this,
	  {
	    parent: {
	      get: function get$$1() {
	        return params.parent;
	      }
	    },
	    scrollable: {
	      get: function get$$1() {
	        return params.scrollable;
	      }
	    },
	    autoPlace: {
	      get: function get$$1() {
	        return params.autoPlace;
	      }
	    },
	    closeOnTop: {
	      get: function get$$1() {
	        return params.closeOnTop;
	      }
	    },
	    preset: {
	      get: function get$$1() {
	        if (_this.parent) {
	          return _this.getRoot().preset;
	        }
	        return params.load.preset;
	      },
	      set: function set$$1(v) {
	        if (_this.parent) {
	          _this.getRoot().preset = v;
	        } else {
	          params.load.preset = v;
	        }
	        setPresetSelectIndex(this);
	        _this.revert();
	      }
	    },
	    width: {
	      get: function get$$1() {
	        return params.width;
	      },
	      set: function set$$1(v) {
	        params.width = v;
	        setWidth(_this, v);
	      }
	    },
	    name: {
	      get: function get$$1() {
	        return params.name;
	      },
	      set: function set$$1(v) {
	        params.name = v;
	        if (titleRow) {
	          titleRow.innerHTML = params.name;
	        }
	      }
	    },
	    closed: {
	      get: function get$$1() {
	        return params.closed;
	      },
	      set: function set$$1(v) {
	        params.closed = v;
	        if (params.closed) {
	          dom.addClass(_this.__ul, GUI.CLASS_CLOSED);
	        } else {
	          dom.removeClass(_this.__ul, GUI.CLASS_CLOSED);
	        }
	        this.onResize();
	        if (_this.__closeButton) {
	          _this.__closeButton.innerHTML = v ? GUI.TEXT_OPEN : GUI.TEXT_CLOSED;
	        }
	      }
	    },
	    load: {
	      get: function get$$1() {
	        return params.load;
	      }
	    },
	    useLocalStorage: {
	      get: function get$$1() {
	        return useLocalStorage;
	      },
	      set: function set$$1(bool) {
	        if (SUPPORTS_LOCAL_STORAGE) {
	          useLocalStorage = bool;
	          if (bool) {
	            dom.bind(window, 'unload', saveToLocalStorage);
	          } else {
	            dom.unbind(window, 'unload', saveToLocalStorage);
	          }
	          localStorage.setItem(getLocalStorageHash(_this, 'isLocal'), bool);
	        }
	      }
	    }
	  });
	  if (Common.isUndefined(params.parent)) {
	    this.closed = params.closed || false;
	    dom.addClass(this.domElement, GUI.CLASS_MAIN);
	    dom.makeSelectable(this.domElement, false);
	    if (SUPPORTS_LOCAL_STORAGE) {
	      if (useLocalStorage) {
	        _this.useLocalStorage = true;
	        var savedGui = localStorage.getItem(getLocalStorageHash(this, 'gui'));
	        if (savedGui) {
	          params.load = JSON.parse(savedGui);
	        }
	      }
	    }
	    this.__closeButton = document.createElement('div');
	    this.__closeButton.innerHTML = GUI.TEXT_CLOSED;
	    dom.addClass(this.__closeButton, GUI.CLASS_CLOSE_BUTTON);
	    if (params.closeOnTop) {
	      dom.addClass(this.__closeButton, GUI.CLASS_CLOSE_TOP);
	      this.domElement.insertBefore(this.__closeButton, this.domElement.childNodes[0]);
	    } else {
	      dom.addClass(this.__closeButton, GUI.CLASS_CLOSE_BOTTOM);
	      this.domElement.appendChild(this.__closeButton);
	    }
	    dom.bind(this.__closeButton, 'click', function () {
	      _this.closed = !_this.closed;
	    });
	  } else {
	    if (params.closed === undefined) {
	      params.closed = true;
	    }
	    var titleRowName = document.createTextNode(params.name);
	    dom.addClass(titleRowName, 'controller-name');
	    titleRow = addRow(_this, titleRowName);
	    var onClickTitle = function onClickTitle(e) {
	      e.preventDefault();
	      _this.closed = !_this.closed;
	      return false;
	    };
	    dom.addClass(this.__ul, GUI.CLASS_CLOSED);
	    dom.addClass(titleRow, 'title');
	    dom.bind(titleRow, 'click', onClickTitle);
	    if (!params.closed) {
	      this.closed = false;
	    }
	  }
	  if (params.autoPlace) {
	    if (Common.isUndefined(params.parent)) {
	      if (autoPlaceVirgin) {
	        autoPlaceContainer = document.createElement('div');
	        dom.addClass(autoPlaceContainer, CSS_NAMESPACE);
	        dom.addClass(autoPlaceContainer, GUI.CLASS_AUTO_PLACE_CONTAINER);
	        document.body.appendChild(autoPlaceContainer);
	        autoPlaceVirgin = false;
	      }
	      autoPlaceContainer.appendChild(this.domElement);
	      dom.addClass(this.domElement, GUI.CLASS_AUTO_PLACE);
	    }
	    if (!this.parent) {
	      setWidth(_this, params.width);
	    }
	  }
	  this.__resizeHandler = function () {
	    _this.onResizeDebounced();
	  };
	  dom.bind(window, 'resize', this.__resizeHandler);
	  dom.bind(this.__ul, 'webkitTransitionEnd', this.__resizeHandler);
	  dom.bind(this.__ul, 'transitionend', this.__resizeHandler);
	  dom.bind(this.__ul, 'oTransitionEnd', this.__resizeHandler);
	  this.onResize();
	  if (params.resizable) {
	    addResizeHandle(this);
	  }
	  saveToLocalStorage = function saveToLocalStorage() {
	    if (SUPPORTS_LOCAL_STORAGE && localStorage.getItem(getLocalStorageHash(_this, 'isLocal')) === 'true') {
	      localStorage.setItem(getLocalStorageHash(_this, 'gui'), JSON.stringify(_this.getSaveObject()));
	    }
	  };
	  this.saveToLocalStorageIfPossible = saveToLocalStorage;
	  function resetWidth() {
	    var root = _this.getRoot();
	    root.width += 1;
	    Common.defer(function () {
	      root.width -= 1;
	    });
	  }
	  if (!params.parent) {
	    resetWidth();
	  }
	};
	GUI.toggleHide = function () {
	  hide = !hide;
	  Common.each(hideableGuis, function (gui) {
	    gui.domElement.style.display = hide ? 'none' : '';
	  });
	};
	GUI.CLASS_AUTO_PLACE = 'a';
	GUI.CLASS_AUTO_PLACE_CONTAINER = 'ac';
	GUI.CLASS_MAIN = 'main';
	GUI.CLASS_CONTROLLER_ROW = 'cr';
	GUI.CLASS_TOO_TALL = 'taller-than-window';
	GUI.CLASS_CLOSED = 'closed';
	GUI.CLASS_CLOSE_BUTTON = 'close-button';
	GUI.CLASS_CLOSE_TOP = 'close-top';
	GUI.CLASS_CLOSE_BOTTOM = 'close-bottom';
	GUI.CLASS_DRAG = 'drag';
	GUI.DEFAULT_WIDTH = 245;
	GUI.TEXT_CLOSED = 'Close Controls';
	GUI.TEXT_OPEN = 'Open Controls';
	GUI._keydownHandler = function (e) {
	  if (document.activeElement.type !== 'text' && (e.which === HIDE_KEY_CODE || e.keyCode === HIDE_KEY_CODE)) {
	    GUI.toggleHide();
	  }
	};
	dom.bind(window, 'keydown', GUI._keydownHandler, false);
	Common.extend(GUI.prototype,
	{
	  add: function add(object, property) {
	    return _add(this, object, property, {
	      factoryArgs: Array.prototype.slice.call(arguments, 2)
	    });
	  },
	  addColor: function addColor(object, property) {
	    return _add(this, object, property, {
	      color: true
	    });
	  },
	  remove: function remove(controller) {
	    this.__ul.removeChild(controller.__li);
	    this.__controllers.splice(this.__controllers.indexOf(controller), 1);
	    var _this = this;
	    Common.defer(function () {
	      _this.onResize();
	    });
	  },
	  destroy: function destroy() {
	    if (this.parent) {
	      throw new Error('Only the root GUI should be removed with .destroy(). ' + 'For subfolders, use gui.removeFolder(folder) instead.');
	    }
	    if (this.autoPlace) {
	      autoPlaceContainer.removeChild(this.domElement);
	    }
	    var _this = this;
	    Common.each(this.__folders, function (subfolder) {
	      _this.removeFolder(subfolder);
	    });
	    dom.unbind(window, 'keydown', GUI._keydownHandler, false);
	    removeListeners(this);
	  },
	  addFolder: function addFolder(name) {
	    if (this.__folders[name] !== undefined) {
	      throw new Error('You already have a folder in this GUI by the' + ' name "' + name + '"');
	    }
	    var newGuiParams = { name: name, parent: this };
	    newGuiParams.autoPlace = this.autoPlace;
	    if (this.load &&
	    this.load.folders &&
	    this.load.folders[name]) {
	      newGuiParams.closed = this.load.folders[name].closed;
	      newGuiParams.load = this.load.folders[name];
	    }
	    var gui = new GUI(newGuiParams);
	    this.__folders[name] = gui;
	    var li = addRow(this, gui.domElement);
	    dom.addClass(li, 'folder');
	    return gui;
	  },
	  removeFolder: function removeFolder(folder) {
	    this.__ul.removeChild(folder.domElement.parentElement);
	    delete this.__folders[folder.name];
	    if (this.load &&
	    this.load.folders &&
	    this.load.folders[folder.name]) {
	      delete this.load.folders[folder.name];
	    }
	    removeListeners(folder);
	    var _this = this;
	    Common.each(folder.__folders, function (subfolder) {
	      folder.removeFolder(subfolder);
	    });
	    Common.defer(function () {
	      _this.onResize();
	    });
	  },
	  open: function open() {
	    this.closed = false;
	  },
	  close: function close() {
	    this.closed = true;
	  },
	  hide: function hide() {
	    this.domElement.style.display = 'none';
	  },
	  show: function show() {
	    this.domElement.style.display = '';
	  },
	  onResize: function onResize() {
	    var root = this.getRoot();
	    if (root.scrollable) {
	      var top = dom.getOffset(root.__ul).top;
	      var h = 0;
	      Common.each(root.__ul.childNodes, function (node) {
	        if (!(root.autoPlace && node === root.__save_row)) {
	          h += dom.getHeight(node);
	        }
	      });
	      if (window.innerHeight - top - CLOSE_BUTTON_HEIGHT < h) {
	        dom.addClass(root.domElement, GUI.CLASS_TOO_TALL);
	        root.__ul.style.height = window.innerHeight - top - CLOSE_BUTTON_HEIGHT + 'px';
	      } else {
	        dom.removeClass(root.domElement, GUI.CLASS_TOO_TALL);
	        root.__ul.style.height = 'auto';
	      }
	    }
	    if (root.__resize_handle) {
	      Common.defer(function () {
	        root.__resize_handle.style.height = root.__ul.offsetHeight + 'px';
	      });
	    }
	    if (root.__closeButton) {
	      root.__closeButton.style.width = root.width + 'px';
	    }
	  },
	  onResizeDebounced: Common.debounce(function () {
	    this.onResize();
	  }, 50),
	  remember: function remember() {
	    if (Common.isUndefined(SAVE_DIALOGUE)) {
	      SAVE_DIALOGUE = new CenteredDiv();
	      SAVE_DIALOGUE.domElement.innerHTML = saveDialogContents;
	    }
	    if (this.parent) {
	      throw new Error('You can only call remember on a top level GUI.');
	    }
	    var _this = this;
	    Common.each(Array.prototype.slice.call(arguments), function (object) {
	      if (_this.__rememberedObjects.length === 0) {
	        addSaveMenu(_this);
	      }
	      if (_this.__rememberedObjects.indexOf(object) === -1) {
	        _this.__rememberedObjects.push(object);
	      }
	    });
	    if (this.autoPlace) {
	      setWidth(this, this.width);
	    }
	  },
	  getRoot: function getRoot() {
	    var gui = this;
	    while (gui.parent) {
	      gui = gui.parent;
	    }
	    return gui;
	  },
	  getSaveObject: function getSaveObject() {
	    var toReturn = this.load;
	    toReturn.closed = this.closed;
	    if (this.__rememberedObjects.length > 0) {
	      toReturn.preset = this.preset;
	      if (!toReturn.remembered) {
	        toReturn.remembered = {};
	      }
	      toReturn.remembered[this.preset] = getCurrentPreset(this);
	    }
	    toReturn.folders = {};
	    Common.each(this.__folders, function (element, key) {
	      toReturn.folders[key] = element.getSaveObject();
	    });
	    return toReturn;
	  },
	  save: function save() {
	    if (!this.load.remembered) {
	      this.load.remembered = {};
	    }
	    this.load.remembered[this.preset] = getCurrentPreset(this);
	    markPresetModified(this, false);
	    this.saveToLocalStorageIfPossible();
	  },
	  saveAs: function saveAs(presetName) {
	    if (!this.load.remembered) {
	      this.load.remembered = {};
	      this.load.remembered[DEFAULT_DEFAULT_PRESET_NAME] = getCurrentPreset(this, true);
	    }
	    this.load.remembered[presetName] = getCurrentPreset(this);
	    this.preset = presetName;
	    addPresetOption(this, presetName, true);
	    this.saveToLocalStorageIfPossible();
	  },
	  revert: function revert(gui) {
	    Common.each(this.__controllers, function (controller) {
	      if (!this.getRoot().load.remembered) {
	        controller.setValue(controller.initialValue);
	      } else {
	        recallSavedValue(gui || this.getRoot(), controller);
	      }
	      if (controller.__onFinishChange) {
	        controller.__onFinishChange.call(controller, controller.getValue());
	      }
	    }, this);
	    Common.each(this.__folders, function (folder) {
	      folder.revert(folder);
	    });
	    if (!gui) {
	      markPresetModified(this.getRoot(), false);
	    }
	  },
	  listen: function listen(controller) {
	    var init = this.__listening.length === 0;
	    this.__listening.push(controller);
	    if (init) {
	      updateDisplays(this.__listening);
	    }
	  },
	  updateDisplay: function updateDisplay() {
	    Common.each(this.__controllers, function (controller) {
	      controller.updateDisplay();
	    });
	    Common.each(this.__folders, function (folder) {
	      folder.updateDisplay();
	    });
	  }
	});
	function addRow(gui, newDom, liBefore) {
	  var li = document.createElement('li');
	  if (newDom) {
	    li.appendChild(newDom);
	  }
	  if (liBefore) {
	    gui.__ul.insertBefore(li, liBefore);
	  } else {
	    gui.__ul.appendChild(li);
	  }
	  gui.onResize();
	  return li;
	}
	function removeListeners(gui) {
	  dom.unbind(window, 'resize', gui.__resizeHandler);
	  if (gui.saveToLocalStorageIfPossible) {
	    dom.unbind(window, 'unload', gui.saveToLocalStorageIfPossible);
	  }
	}
	function markPresetModified(gui, modified) {
	  var opt = gui.__preset_select[gui.__preset_select.selectedIndex];
	  if (modified) {
	    opt.innerHTML = opt.value + '*';
	  } else {
	    opt.innerHTML = opt.value;
	  }
	}
	function augmentController(gui, li, controller) {
	  controller.__li = li;
	  controller.__gui = gui;
	  Common.extend(controller,                                   {
	    options: function options(_options) {
	      if (arguments.length > 1) {
	        var nextSibling = controller.__li.nextElementSibling;
	        controller.remove();
	        return _add(gui, controller.object, controller.property, {
	          before: nextSibling,
	          factoryArgs: [Common.toArray(arguments)]
	        });
	      }
	      if (Common.isArray(_options) || Common.isObject(_options)) {
	        var _nextSibling = controller.__li.nextElementSibling;
	        controller.remove();
	        return _add(gui, controller.object, controller.property, {
	          before: _nextSibling,
	          factoryArgs: [_options]
	        });
	      }
	    },
	    name: function name(_name) {
	      controller.__li.firstElementChild.firstElementChild.innerHTML = _name;
	      return controller;
	    },
	    listen: function listen() {
	      controller.__gui.listen(controller);
	      return controller;
	    },
	    remove: function remove() {
	      controller.__gui.remove(controller);
	      return controller;
	    }
	  });
	  if (controller instanceof NumberControllerSlider) {
	    var box = new NumberControllerBox(controller.object, controller.property, { min: controller.__min, max: controller.__max, step: controller.__step });
	    Common.each(['updateDisplay', 'onChange', 'onFinishChange', 'step', 'min', 'max'], function (method) {
	      var pc = controller[method];
	      var pb = box[method];
	      controller[method] = box[method] = function () {
	        var args = Array.prototype.slice.call(arguments);
	        pb.apply(box, args);
	        return pc.apply(controller, args);
	      };
	    });
	    dom.addClass(li, 'has-slider');
	    controller.domElement.insertBefore(box.domElement, controller.domElement.firstElementChild);
	  } else if (controller instanceof NumberControllerBox) {
	    var r = function r(returned) {
	      if (Common.isNumber(controller.__min) && Common.isNumber(controller.__max)) {
	        var oldName = controller.__li.firstElementChild.firstElementChild.innerHTML;
	        var wasListening = controller.__gui.__listening.indexOf(controller) > -1;
	        controller.remove();
	        var newController = _add(gui, controller.object, controller.property, {
	          before: controller.__li.nextElementSibling,
	          factoryArgs: [controller.__min, controller.__max, controller.__step]
	        });
	        newController.name(oldName);
	        if (wasListening) newController.listen();
	        return newController;
	      }
	      return returned;
	    };
	    controller.min = Common.compose(r, controller.min);
	    controller.max = Common.compose(r, controller.max);
	  } else if (controller instanceof BooleanController) {
	    dom.bind(li, 'click', function () {
	      dom.fakeEvent(controller.__checkbox, 'click');
	    });
	    dom.bind(controller.__checkbox, 'click', function (e) {
	      e.stopPropagation();
	    });
	  } else if (controller instanceof FunctionController) {
	    dom.bind(li, 'click', function () {
	      dom.fakeEvent(controller.__button, 'click');
	    });
	    dom.bind(li, 'mouseover', function () {
	      dom.addClass(controller.__button, 'hover');
	    });
	    dom.bind(li, 'mouseout', function () {
	      dom.removeClass(controller.__button, 'hover');
	    });
	  } else if (controller instanceof ColorController) {
	    dom.addClass(li, 'color');
	    controller.updateDisplay = Common.compose(function (val) {
	      li.style.borderLeftColor = controller.__color.toString();
	      return val;
	    }, controller.updateDisplay);
	    controller.updateDisplay();
	  }
	  controller.setValue = Common.compose(function (val) {
	    if (gui.getRoot().__preset_select && controller.isModified()) {
	      markPresetModified(gui.getRoot(), true);
	    }
	    return val;
	  }, controller.setValue);
	}
	function recallSavedValue(gui, controller) {
	  var root = gui.getRoot();
	  var matchedIndex = root.__rememberedObjects.indexOf(controller.object);
	  if (matchedIndex !== -1) {
	    var controllerMap = root.__rememberedObjectIndecesToControllers[matchedIndex];
	    if (controllerMap === undefined) {
	      controllerMap = {};
	      root.__rememberedObjectIndecesToControllers[matchedIndex] = controllerMap;
	    }
	    controllerMap[controller.property] = controller;
	    if (root.load && root.load.remembered) {
	      var presetMap = root.load.remembered;
	      var preset = void 0;
	      if (presetMap[gui.preset]) {
	        preset = presetMap[gui.preset];
	      } else if (presetMap[DEFAULT_DEFAULT_PRESET_NAME]) {
	        preset = presetMap[DEFAULT_DEFAULT_PRESET_NAME];
	      } else {
	        return;
	      }
	      if (preset[matchedIndex] && preset[matchedIndex][controller.property] !== undefined) {
	        var value = preset[matchedIndex][controller.property];
	        controller.initialValue = value;
	        controller.setValue(value);
	      }
	    }
	  }
	}
	function _add(gui, object, property, params) {
	  if (object[property] === undefined) {
	    throw new Error('Object "' + object + '" has no property "' + property + '"');
	  }
	  var controller = void 0;
	  if (params.color) {
	    controller = new ColorController(object, property);
	  } else {
	    var factoryArgs = [object, property].concat(params.factoryArgs);
	    controller = ControllerFactory.apply(gui, factoryArgs);
	  }
	  if (params.before instanceof Controller) {
	    params.before = params.before.__li;
	  }
	  recallSavedValue(gui, controller);
	  dom.addClass(controller.domElement, 'c');
	  var name = document.createElement('span');
	  dom.addClass(name, 'property-name');
	  name.innerHTML = controller.property;
	  var container = document.createElement('div');
	  container.appendChild(name);
	  container.appendChild(controller.domElement);
	  var li = addRow(gui, container, params.before);
	  dom.addClass(li, GUI.CLASS_CONTROLLER_ROW);
	  if (controller instanceof ColorController) {
	    dom.addClass(li, 'color');
	  } else {
	    dom.addClass(li, _typeof(controller.getValue()));
	  }
	  augmentController(gui, li, controller);
	  gui.__controllers.push(controller);
	  return controller;
	}
	function getLocalStorageHash(gui, key) {
	  return document.location.href + '.' + key;
	}
	function addPresetOption(gui, name, setSelected) {
	  var opt = document.createElement('option');
	  opt.innerHTML = name;
	  opt.value = name;
	  gui.__preset_select.appendChild(opt);
	  if (setSelected) {
	    gui.__preset_select.selectedIndex = gui.__preset_select.length - 1;
	  }
	}
	function showHideExplain(gui, explain) {
	  explain.style.display = gui.useLocalStorage ? 'block' : 'none';
	}
	function addSaveMenu(gui) {
	  var div = gui.__save_row = document.createElement('li');
	  dom.addClass(gui.domElement, 'has-save');
	  gui.__ul.insertBefore(div, gui.__ul.firstChild);
	  dom.addClass(div, 'save-row');
	  var gears = document.createElement('span');
	  gears.innerHTML = '&nbsp;';
	  dom.addClass(gears, 'button gears');
	  var button = document.createElement('span');
	  button.innerHTML = 'Save';
	  dom.addClass(button, 'button');
	  dom.addClass(button, 'save');
	  var button2 = document.createElement('span');
	  button2.innerHTML = 'New';
	  dom.addClass(button2, 'button');
	  dom.addClass(button2, 'save-as');
	  var button3 = document.createElement('span');
	  button3.innerHTML = 'Revert';
	  dom.addClass(button3, 'button');
	  dom.addClass(button3, 'revert');
	  var select = gui.__preset_select = document.createElement('select');
	  if (gui.load && gui.load.remembered) {
	    Common.each(gui.load.remembered, function (value, key) {
	      addPresetOption(gui, key, key === gui.preset);
	    });
	  } else {
	    addPresetOption(gui, DEFAULT_DEFAULT_PRESET_NAME, false);
	  }
	  dom.bind(select, 'change', function () {
	    for (var index = 0; index < gui.__preset_select.length; index++) {
	      gui.__preset_select[index].innerHTML = gui.__preset_select[index].value;
	    }
	    gui.preset = this.value;
	  });
	  div.appendChild(select);
	  div.appendChild(gears);
	  div.appendChild(button);
	  div.appendChild(button2);
	  div.appendChild(button3);
	  if (SUPPORTS_LOCAL_STORAGE) {
	    var explain = document.getElementById('dg-local-explain');
	    var localStorageCheckBox = document.getElementById('dg-local-storage');
	    var saveLocally = document.getElementById('dg-save-locally');
	    saveLocally.style.display = 'block';
	    if (localStorage.getItem(getLocalStorageHash(gui, 'isLocal')) === 'true') {
	      localStorageCheckBox.setAttribute('checked', 'checked');
	    }
	    showHideExplain(gui, explain);
	    dom.bind(localStorageCheckBox, 'change', function () {
	      gui.useLocalStorage = !gui.useLocalStorage;
	      showHideExplain(gui, explain);
	    });
	  }
	  var newConstructorTextArea = document.getElementById('dg-new-constructor');
	  dom.bind(newConstructorTextArea, 'keydown', function (e) {
	    if (e.metaKey && (e.which === 67 || e.keyCode === 67)) {
	      SAVE_DIALOGUE.hide();
	    }
	  });
	  dom.bind(gears, 'click', function () {
	    newConstructorTextArea.innerHTML = JSON.stringify(gui.getSaveObject(), undefined, 2);
	    SAVE_DIALOGUE.show();
	    newConstructorTextArea.focus();
	    newConstructorTextArea.select();
	  });
	  dom.bind(button, 'click', function () {
	    gui.save();
	  });
	  dom.bind(button2, 'click', function () {
	    var presetName = prompt('Enter a new preset name.');
	    if (presetName) {
	      gui.saveAs(presetName);
	    }
	  });
	  dom.bind(button3, 'click', function () {
	    gui.revert();
	  });
	}
	function addResizeHandle(gui) {
	  var pmouseX = void 0;
	  gui.__resize_handle = document.createElement('div');
	  Common.extend(gui.__resize_handle.style, {
	    width: '6px',
	    marginLeft: '-3px',
	    height: '200px',
	    cursor: 'ew-resize',
	    position: 'absolute'
	  });
	  function drag(e) {
	    e.preventDefault();
	    gui.width += pmouseX - e.clientX;
	    gui.onResize();
	    pmouseX = e.clientX;
	    return false;
	  }
	  function dragStop() {
	    dom.removeClass(gui.__closeButton, GUI.CLASS_DRAG);
	    dom.unbind(window, 'mousemove', drag);
	    dom.unbind(window, 'mouseup', dragStop);
	  }
	  function dragStart(e) {
	    e.preventDefault();
	    pmouseX = e.clientX;
	    dom.addClass(gui.__closeButton, GUI.CLASS_DRAG);
	    dom.bind(window, 'mousemove', drag);
	    dom.bind(window, 'mouseup', dragStop);
	    return false;
	  }
	  dom.bind(gui.__resize_handle, 'mousedown', dragStart);
	  dom.bind(gui.__closeButton, 'mousedown', dragStart);
	  gui.domElement.insertBefore(gui.__resize_handle, gui.domElement.firstElementChild);
	}
	function setWidth(gui, w) {
	  gui.domElement.style.width = w + 'px';
	  if (gui.__save_row && gui.autoPlace) {
	    gui.__save_row.style.width = w + 'px';
	  }
	  if (gui.__closeButton) {
	    gui.__closeButton.style.width = w + 'px';
	  }
	}
	function getCurrentPreset(gui, useInitialValues) {
	  var toReturn = {};
	  Common.each(gui.__rememberedObjects, function (val, index) {
	    var savedValues = {};
	    var controllerMap = gui.__rememberedObjectIndecesToControllers[index];
	    Common.each(controllerMap, function (controller, property) {
	      savedValues[property] = useInitialValues ? controller.initialValue : controller.getValue();
	    });
	    toReturn[index] = savedValues;
	  });
	  return toReturn;
	}
	function setPresetSelectIndex(gui) {
	  for (var index = 0; index < gui.__preset_select.length; index++) {
	    if (gui.__preset_select[index].value === gui.preset) {
	      gui.__preset_select.selectedIndex = index;
	    }
	  }
	}
	function updateDisplays(controllerArray) {
	  if (controllerArray.length !== 0) {
	    requestAnimationFrame$1$1.call(window, function () {
	      updateDisplays(controllerArray);
	    });
	  }
	  Common.each(controllerArray, function (c) {
	    c.updateDisplay();
	  });
	}
	var GUI$1 = GUI;

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

	// NO NEED TO IMPORT dvlpThree - it's added by rollup so it works with both THREE and dvlpThreee
	const { AmbientLight, Box3, Color: Color$1, Group, HemisphereLight, PerspectiveCamera, Scene, SpotLight, WebGLRenderer, OrbitControls } = dvlpThree;
	// import { OrbitControls } from 'dvlp-three/examples/jsm/controls/OrbitControls.js';

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

	  var gui = new GUI$1();
	  gui.controls = controls;
	  const dropdown = gui.add(controls, 'state').options(Object.keys(models));

	  dropdown.onChange(item => {
	    fileLoader.loadURL(models[item]);
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
	  renderer.setClearColor(new Color$1(0.7, 0.8, 0.8));
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
	      killWorkers();
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

	// fileLoader = new Loader(obj => setupNewObject(obj));

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

	  if (OrbitControls) {
	    ocontrols = new OrbitControls(camera, domElement);
	    ocontrols.target.set(modelMaxWidthDepth / 2, (boxScale.max.y - boxScale.min.y) / 2, 0);
	  } else {
	    console.warn('Update this code to work with THREE 117+');
	  }

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

	var main = { OptiMesh };

	exports.createWorkers = createWorkers;
	exports.default = main;
	exports.editorPlugin = editorPlugin;
	exports.meshSimplifier = meshSimplifier;
	exports.openOptimizer = openOptimizer;
	exports.setBoneCosts = setBoneCosts;

	return exports;

}({}));
