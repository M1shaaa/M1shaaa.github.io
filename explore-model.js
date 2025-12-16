// Temporary script to explore the environment.glb model structure
const { readFileSync } = require('fs');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader');

const loader = new GLTFLoader();

// Load the model
const modelPath = './static/models/World/environment.glb';
const modelData = readFileSync(modelPath);
const arrayBuffer = modelData.buffer.slice(modelData.byteOffset, modelData.byteOffset + modelData.byteLength);

loader.parse(arrayBuffer, '', (gltf) => {
    console.log('\n=== ENVIRONMENT.GLB MODEL STRUCTURE ===\n');

    function printNode(node, depth = 0) {
        const indent = '  '.repeat(depth);
        const type = node.type || 'Object3D';
        const name = node.name || '(unnamed)';

        console.log(`${indent}├─ [${type}] ${name}`);

        if (node.children) {
            node.children.forEach(child => printNode(child, depth + 1));
        }
    }

    printNode(gltf.scene);

    console.log('\n=== MESH NAMES ===\n');
    const meshes = [];
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            meshes.push(child.name);
        }
    });

    meshes.forEach((name, i) => {
        console.log(`${i + 1}. ${name}`);
    });

    console.log(`\nTotal meshes: ${meshes.length}\n`);
}, (error) => {
    console.error('Error loading model:', error);
});
