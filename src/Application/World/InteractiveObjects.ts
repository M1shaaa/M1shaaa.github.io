import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Mouse from '../Utils/Mouse';

export default class InteractiveObjects {
    application: Application;
    scene: THREE.Scene;
    camera: Camera;
    mouse: Mouse;
    raycaster: THREE.Raycaster;
    interactiveObjects: Map<string, InteractiveObject>;
    decorModel: THREE.Group;
    audioManager: any;
    isInteracting: boolean;
    originalCameraState: CameraKey | undefined;
    isDragging: boolean;
    draggedObject: THREE.Mesh | null;
    dragPlane: THREE.Plane;
    dragOffset: THREE.Vector3;
    binderStates: Map<string, boolean>;
    coffeeSteamOffset: THREE.Vector3 | null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.mouse = this.application.mouse;
        this.raycaster = new THREE.Raycaster();
        this.interactiveObjects = new Map();
        this.isInteracting = false;
        this.isDragging = false;
        this.draggedObject = null;
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.dragOffset = new THREE.Vector3();
        this.binderStates = new Map();
        this.coffeeSteamOffset = null;

        this.setupInteractions();
    }

    setDecorModel(model: THREE.Group) {
        this.decorModel = model;
        this.audioManager = this.application.world.audioManager;
        this.registerInteractiveObjects();
        this.setupPhysics();
        this.initializeCoffeeSteamOffset();
    }

    registerInteractiveObjects() {
        // Find all meshes in the decor model
        const meshes: { [key: string]: THREE.Mesh } = {};

        this.decorModel.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                meshes[child.name] = child;
                console.log('Found mesh:', child.name); // Debug
            }
        });

        // Register only coffee and binders as interactive
        if (meshes['coffee']) {
            this.interactiveObjects.set('coffee', {
                mesh: meshes['coffee'],
                originalPosition: meshes['coffee'].position.clone(),
                originalRotation: meshes['coffee'].rotation.clone(),
                onInteract: () => {},
            });
        }

        if (meshes['binder_1']) {
            this.interactiveObjects.set('binder_1', {
                mesh: meshes['binder_1'],
                originalPosition: meshes['binder_1'].position.clone(),
                originalRotation: meshes['binder_1'].rotation.clone(),
                onInteract: () => this.onBinderClick(meshes['binder_1'], 'binder_1'),
            });
            this.binderStates.set('binder_1', false);
        }

        if (meshes['binder_2']) {
            this.interactiveObjects.set('binder_2', {
                mesh: meshes['binder_2'],
                originalPosition: meshes['binder_2'].position.clone(),
                originalRotation: meshes['binder_2'].rotation.clone(),
                onInteract: () => this.onBinderClick(meshes['binder_2'], 'binder_2'),
            });
            this.binderStates.set('binder_2', false);
        }
    }

    setupInteractions() {
        const canvas = this.application.renderer.instance.domElement;

        // Mouse down - start drag
        window.addEventListener('mousedown', (event) => {
            // @ts-ignore
            if (event.inComputer) return;

            const rect = canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera({ x, y }, this.camera.instance);

            const meshes = Array.from(this.interactiveObjects.values()).map(
                (obj) => obj.mesh
            );

            const intersects = this.raycaster.intersectObjects(meshes, false);

            if (intersects.length > 0) {
                // Stop propagation to prevent camera zoom
                event.stopPropagation();

                const clickedMesh = intersects[0].object as THREE.Mesh;
                this.startDrag(clickedMesh, intersects[0].point);
            }
        });

        // Mouse move - drag object
        window.addEventListener('mousemove', (event) => {
            if (!this.isDragging || !this.draggedObject) return;

            const rect = canvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera({ x, y }, this.camera.instance);

            const intersectPoint = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint);

            if (intersectPoint) {
                this.draggedObject.position.copy(intersectPoint).add(this.dragOffset);

                // Move related objects (paper holders, etc.)
                const related = this.relatedObjects.get(this.draggedObject.name);
                if (related && this.draggedObject) {
                    related.forEach(({ mesh, offset }) => {
                        if (this.draggedObject) {
                            mesh.position.copy(this.draggedObject.position).add(offset);
                        }
                    });
                }

                // Update coffee steam position if dragging coffee
                if (this.draggedObject.name === 'coffee' && this.coffeeSteamOffset) {
                    const coffeeSteam = this.application.world.coffeeSteam;
                    if (coffeeSteam && coffeeSteam.model && coffeeSteam.model.mesh) {
                        coffeeSteam.model.mesh.position.copy(this.draggedObject.position).add(this.coffeeSteamOffset);
                    }
                }
            }
        });

        // Mouse up - end drag
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.endDrag();
            }
        });
    }

    startDrag(mesh: THREE.Mesh, intersectPoint: THREE.Vector3) {
        // Check if it's a binder - use special interaction
        const meshName = mesh.name;
        if (meshName === 'binder_1' || meshName === 'binder_2') {
            this.onBinderClick(mesh, meshName);
            return;
        }

        this.isDragging = true;
        this.draggedObject = mesh;
        this.isInteracting = true;

        // Store initial position of related objects
        this.storeRelatedObjectPositions(mesh);

        // Set drag plane at the object's Y position
        this.dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            mesh.position
        );

        // Calculate offset
        this.dragOffset.copy(mesh.position).sub(intersectPoint);

        console.log('🎯 Started dragging:', mesh.name);
    }

    relatedObjects: Map<string, { mesh: THREE.Mesh; offset: THREE.Vector3 }[]> = new Map();

    storeRelatedObjectPositions(mesh: THREE.Mesh) {
        const related: { mesh: THREE.Mesh; offset: THREE.Vector3 }[] = [];

        // Find related meshes based on naming and proximity
        if (mesh.name === 'paper_stack_1' || mesh.name === 'paper_stack_2') {
            // For paper stacks, find the holders and only associate with the CLOSEST ones
            const holders: { mesh: THREE.Mesh; distance: number }[] = [];

            this.decorModel.traverse((child) => {
                if (child instanceof THREE.Mesh &&
                    (child.name === 'paper_holder_bottom' || child.name === 'paper_holder_top')) {
                    const distance = child.position.distanceTo(mesh.position);
                    holders.push({ mesh: child, distance });
                }
            });

            // Sort by distance and only take the closest 2 (top and bottom)
            holders.sort((a, b) => a.distance - b.distance);
            const closestHolders = holders.slice(0, 2);

            closestHolders.forEach(({ mesh: holderMesh, distance }) => {
                // Only associate if really close (within 200 units)
                if (distance < 200) {
                    related.push({
                        mesh: holderMesh,
                        offset: holderMesh.position.clone().sub(mesh.position),
                    });
                    console.log(`Associated ${holderMesh.name} with ${mesh.name} (distance: ${distance.toFixed(0)})`);
                }
            });
        }

        if (related.length > 0) {
            this.relatedObjects.set(mesh.name, related);
            console.log(`Found ${related.length} related objects for ${mesh.name}`);
        }
    }

    endDrag() {
        if (this.draggedObject) {
            console.log('🎯 Stopped dragging:', this.draggedObject.name);
        }

        this.isDragging = false;
        this.draggedObject = null;
        this.isInteracting = false;
    }

    startInteraction() {
        this.isInteracting = true;
        // Store current camera state
        this.originalCameraState = this.camera.currentKeyframe;
    }

    endInteraction() {
        this.isInteracting = false;
    }

    setupPhysics() {
        const physics = this.application.world.physics;
        if (!physics) return;

        // Add physics bodies for interactive objects
        // Note: Don't add physics bodies yet - we'll add them dynamically when clicked
        // This prevents objects from falling through the desk on load
    }

    initializeCoffeeSteamOffset() {
        // Calculate the offset between coffee cup and steam
        const coffeeObj = this.interactiveObjects.get('coffee');
        const coffeeSteam = this.application.world.coffeeSteam;

        if (coffeeObj && coffeeSteam && coffeeSteam.model && coffeeSteam.model.mesh) {
            this.coffeeSteamOffset = coffeeSteam.model.mesh.position.clone().sub(coffeeObj.mesh.position);
            console.log('☕ Coffee steam offset initialized:', this.coffeeSteamOffset);
        }
    }

    onCoffeeClick(mesh: THREE.Mesh) {
        console.log('☕ Coffee cup clicked - using physics!');

        const physics = this.application.world.physics;
        if (!physics) return;

        // Play sound effect
        this.audioManager.playAudio('mouseDown', {
            volume: 0.5,
            position: mesh.position.clone(),
            refDistance: 3000,
        });

        // Apply upward impulse to lift the cup
        physics.applyImpulse(
            mesh,
            new THREE.Vector3(0, 15000, 0) // Upward force
        );

        // End interaction after a delay
        setTimeout(() => {
            this.endInteraction();
        }, 1500);
    }

    onPlantClick(mesh: THREE.Mesh) {
        console.log('🌿 Plant knocked over - using physics!');

        const physics = this.application.world.physics;
        if (!physics) return;

        // Play whoosh sound
        this.audioManager.playAudio('startup', {
            volume: 0.5,
            pitch: 10,
            position: mesh.position.clone(),
            refDistance: 3000,
        });

        // Apply force to tip it over
        // Force applied to the top of the plant will make it tip realistically
        const topPoint = mesh.position.clone();
        topPoint.y += 200; // Apply force at top

        physics.applyImpulse(
            mesh,
            new THREE.Vector3(-8000, 0, 0), // Sideways force
            topPoint
        );

        // End interaction after a delay
        setTimeout(() => {
            this.endInteraction();
        }, 3000);
    }

    onBinderClick(mesh: THREE.Mesh, name: string) {
        console.log(`📔 ${name} clicked!`);

        // Check if binder is already animating
        if (this.binderStates.get(name)) {
            console.log(`📔 ${name} is already animating, ignoring click`);
            return;
        }

        const obj = Array.from(this.interactiveObjects.values()).find(
            (o) => o.mesh === mesh
        );
        if (!obj) return;

        // Mark binder as animating
        this.binderStates.set(name, true);

        // Play flip sound (using keyboard sound as placeholder)
        this.audioManager.playAudio('keyboardKeydown', {
            volume: 0.6,
            position: mesh.position.clone(),
            refDistance: 3000,
        });

        // Both binders show paper content
        const displayTime = name === 'binder_2' ? 6000 : 3000; // 6s for binder_2, 3s for binder_1

        // Flip binder open animation
        const originalRotationX = obj.originalRotation.x;
        new TWEEN.Tween(mesh.rotation)
            .to({ x: originalRotationX + 0.7 }, 500)
            .easing(TWEEN.Easing.Back.Out)
            .onComplete(() => {
                // Close it back after paper flies out
                setTimeout(() => {
                    new TWEEN.Tween(mesh.rotation)
                        .to({ x: originalRotationX }, 600)
                        .easing(TWEEN.Easing.Quadratic.InOut)
                        .onComplete(() => {
                            this.endInteraction();
                            // Reset binder state so it can be clicked again
                            this.binderStates.set(name, false);
                        })
                        .start();
                }, displayTime);
            })
            .start();

        // Shoot a paper out toward camera after a brief delay
        setTimeout(() => {
            this.shootBinderPaper(name, mesh.position, mesh.rotation);
        }, 300);
    }

    shootBinderPaper(
        binderName: string,
        startPosition: THREE.Vector3,
        binderRotation: THREE.Euler
    ) {
        if (binderName === 'binder_1') {
            // Load Rick Astley image for binder_1 and composite it on paper background
            const loader = new THREE.TextureLoader();
            loader.load('images/rick-astley.png', (imageTexture) => {
                // Create canvas for paper background
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 1024;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Draw binder page background
                ctx.fillStyle = '#f5f5dc'; // Beige paper color
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Add notebook lines
                ctx.strokeStyle = '#d4d4ff';
                ctx.lineWidth = 2;
                for (let i = 100; i < canvas.height - 100; i += 40) {
                    ctx.beginPath();
                    ctx.moveTo(100, i);
                    ctx.lineTo(canvas.width - 100, i);
                    ctx.stroke();
                }

                // Add red margin line
                ctx.strokeStyle = '#ff6b6b';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(150, 80);
                ctx.lineTo(150, canvas.height - 80);
                ctx.stroke();

                // Draw the Rick Astley image on top of the paper
                const img = imageTexture.image;
                // Center it on the page
                const imgWidth = 700;
                const imgHeight = (img.height / img.width) * imgWidth;
                const x = (canvas.width - imgWidth) / 2;
                const y = (canvas.height - imgHeight) / 2;
                ctx.drawImage(img, x, y, imgWidth, imgHeight);

                // Create texture from canvas
                const texture = new THREE.CanvasTexture(canvas);
                texture.needsUpdate = true;

                this.displayBinderPage(texture, binderName);
            }, undefined, (error) => {
                console.error('Error loading Rick Astley image:', error);
            });
        } else {
            // Create canvas for binder_2 content
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 1024;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Draw binder page background
            ctx.fillStyle = '#f5f5dc'; // Beige paper color
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Add notebook lines
            ctx.strokeStyle = '#d4d4ff';
            ctx.lineWidth = 2;
            for (let i = 100; i < canvas.height - 100; i += 40) {
                ctx.beginPath();
                ctx.moveTo(100, i);
                ctx.lineTo(canvas.width - 100, i);
                ctx.stroke();
            }

            // Add red margin line
            ctx.strokeStyle = '#ff6b6b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(150, 80);
            ctx.lineTo(150, canvas.height - 80);
            ctx.stroke();

            // Funny binder page content
            // Add date in top left
            ctx.fillStyle = '#999';
            ctx.font = '20px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('2002', 180, 100);

            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 48px Arial';
            ctx.fillText('IMPORTANT NOTES', 160, 150);
            ctx.font = '32px Arial';
            ctx.fillStyle = '#333';

            ctx.fillText('TODO:', 180, 220);
            ctx.font = '28px Arial';
            ctx.fillText('1. Delete this later', 200, 270);

            ctx.fillStyle = '#333';
            ctx.font = '28px Arial';
            ctx.fillText('2. Remember password:', 200, 330);
            ctx.fillText('   password123', 220, 370);

            // Cross it out
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(220, 365);
            ctx.lineTo(420, 365);
            ctx.stroke();

            ctx.fillText('   hunter2', 220, 410);
            ctx.fillText('3. Call mom', 200, 470);

            // Create texture from canvas
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;

            this.displayBinderPage(texture, binderName);
        }
    }

    displayBinderPage(texture: THREE.Texture, binderName: string) {
        // Create plane for the binder page
        const geometry = new THREE.PlaneGeometry(2000, 2000);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: false,
        });
        const plane = new THREE.Mesh(geometry, material);

        // Position it like the computer screen - to the right of center
        plane.position.set(800, 900, 1500); // To the right, in front of desk

        // Rotation to face the camera (similar to monitor)
        plane.rotation.set(0, 0, 0);

        // Start small
        plane.scale.set(0.05, 0.05, 0.05);

        this.scene.add(plane);

        // Scale up animation (no flying, just appears)
        new TWEEN.Tween(plane.scale)
            .to({ x: 1, y: 1, z: 1 }, 400)
            .easing(TWEEN.Easing.Back.Out)
            .start();

        // Hold for 3s (binder_1) or 6s (binder_2), then fade out
        const displayTime = binderName === 'binder_2' ? 6000 : 3000;
        setTimeout(() => {
            new TWEEN.Tween(material)
                .to({ opacity: 0 }, 600)
                .onStart(() => {
                    material.transparent = true;
                })
                .onComplete(() => {
                    this.scene.remove(plane);
                    geometry.dispose();
                    material.dispose();
                    texture.dispose();
                })
                .start();
        }, displayTime);
    }

    onPaperStackClick(mesh: THREE.Mesh) {
        console.log('📄 Paper stack - using physics!');

        const physics = this.application.world.physics;
        if (!physics) return;

        // Play paper sound
        this.audioManager.playAudio('mouseUp', {
            volume: 0.6,
            position: mesh.position.clone(),
            refDistance: 3000,
        });

        // Apply random impulse to make papers fly
        const randomX = (Math.random() - 0.5) * 5000;
        const randomZ = (Math.random() - 0.5) * 5000;

        physics.applyImpulse(
            mesh,
            new THREE.Vector3(randomX, 12000, randomZ) // Launch upward with spin
        );

        // Add some angular velocity for spinning
        const body = physics.physicsBodies.get(mesh);
        if (body) {
            body.angularVelocity.set(
                Math.random() * 10 - 5,
                Math.random() * 10 - 5,
                Math.random() * 10 - 5
            );
        }

        // End interaction after a delay
        setTimeout(() => {
            this.endInteraction();
        }, 2000);
    }

    captureSceneSnapshot(): HTMLCanvasElement | null {
        try {
            // Get the current renderer canvas
            const rendererCanvas = this.application.renderer.instance.domElement;

            // Create a new canvas to store the snapshot
            const snapshotCanvas = document.createElement('canvas');
            snapshotCanvas.width = rendererCanvas.width;
            snapshotCanvas.height = rendererCanvas.height;

            const ctx = snapshotCanvas.getContext('2d');
            if (!ctx) return null;

            // Draw the current renderer canvas to our snapshot
            ctx.drawImage(rendererCanvas, 0, 0);

            return snapshotCanvas;
        } catch (error) {
            console.error('Failed to capture scene snapshot:', error);
            return null;
        }
    }

    update() {
        TWEEN.update();
    }
}

interface InteractiveObject {
    mesh: THREE.Mesh;
    originalPosition: THREE.Vector3;
    originalRotation: THREE.Euler;
    onInteract: () => void;
}
