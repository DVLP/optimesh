var dvlpThree = (typeof dvlpThree !== 'undefined' && dvlpThree) || (typeof dvlpThree$1 !== 'undefined' && dvlpThree$1) || (typeof THREE !== 'undefined' && THREE);
var optimesh = (function (exports, dvlpThree) {
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

	// const {
	//   Vector2, Vector3, BufferAttribute, BufferGeometry
	// } = dvlpThree;
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
	    if (isSAB) {
	      reusingDataArrays.vertexWorkStatus.fill(0);
	      reusingDataArrays.buildIndexStatus.fill(0);
	      reusingDataArrays.vertexNeighboursView.fill(0);
	      reusingDataArrays.vertexFacesView.fill(0);
	      reusingDataArrays.boneCosts.fill(0);
	    }    
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
	var cb = new dvlpThree.Vector3(),
	  ab = new dvlpThree.Vector3();
	var v1Temp = new dvlpThree.Vector3(),
	  v2Temp = new dvlpThree.Vector3();
	var v2Tmp = new dvlpThree.Vector2();
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

	  mapNewToOld = mapNewToOld.slice(0, uniqueVertices.length); // is length inclusive?

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
	  const geo = new dvlpThree.BufferGeometry();
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
	    geo.setIndex(new dvlpThree.BufferAttribute(newindex, 1));

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
	      setAttribute.call(geo, attrib.name, new dvlpThree.BufferAttribute(reindexedAttribute, attrib.itemSize)); // TODO: when changing 3 to attrib.itemSize it all breaks
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
	    setAttribute.call(geo, 'position', new dvlpThree.BufferAttribute(positions, 3));

	    if (normals.length > 0) {
	      setAttribute.call(geo, 'normal', new dvlpThree.BufferAttribute(normals, 3));
	    }

	    if (uvs.length > 0) {
	      setAttribute.call(geo, 'uv', new dvlpThree.BufferAttribute(uvs, 2));
	    }

	    if (skinIndexArr.length > 0) {
	      setAttribute.call(geo, 'skinIndex', new dvlpThree.BufferAttribute(skinIndexArr, 4));
	    }

	    if (skinWeightArr.length > 0) {
	      setAttribute.call(geo, 'skinWeight', new dvlpThree.BufferAttribute(skinWeightArr, 4));
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

	function editorAction(editor) {
	  if (!editor.selected) {
	    return alert('select an object');
	  }
	  if (!editor.selected.isMesh) {
	    return alert('select valid geometry');
	  }

	  const selected = editor.selected;

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
	  // openOptimizer,
	  // setBoneCosts,
	};

	var main = { OptiMesh };
	// export { createWorkers, meshSimplifier };

	exports.createWorkers = createWorkers;
	exports.default = main;
	exports.meshSimplifier = meshSimplifier;

	return exports;

}({}, dvlpThree));
