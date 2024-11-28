//
// build index and unique positions
// it's like indexed geometry but only index and positions attributes
// using non-indexed geometry for other attributes to preserve all the details
//

export const getIndexedPositions = (function() {
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
