import { meshSimplifier, createWorkers } from './MeshSimplifier';
// import { openOptimizer, setBoneCosts } from './OptimPopup';
import { skinnedMeshClone } from './skinnedMeshClone';

function editorAction(editor) {
  if (!editor.selected) {
    return alert('select an object');
  }
  if (!editor.selected.isMesh) {
    return alert('select valid geometry');
  }

  const selected = editor.selected;

  // openOptimizer(selected.isSkinnedMesh ? skinnedMeshClone(selected) : selected.clone(), onDone);

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
  // openOptimizer,
  // setBoneCosts,
};

export default { OptiMesh };
export { createWorkers, meshSimplifier };
// export { createWorkers, meshSimplifier };
