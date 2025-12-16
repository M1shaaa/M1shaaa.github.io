import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import Application from '../Application';

export default class Physics {
    application: Application;
    world: CANNON.World;
    scene: THREE.Scene;
    physicsBodies: Map<THREE.Mesh, CANNON.Body>;
    timeStep: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.physicsBodies = new Map();
        this.timeStep = 1 / 60;

        this.setupWorld();
    }

    setupWorld() {
        // Create physics world
        this.world = new CANNON.World();
        this.world.gravity.set(0, -9820, 0); // Earth gravity in mm/s²
        this.world.broadphase = new CANNON.NaiveBroadphase();

        // Set solver iterations
        const solver = this.world.solver as CANNON.GSSolver;
        solver.iterations = 10;

        // Add ground plane
        const groundBody = new CANNON.Body({
            mass: 0, // mass = 0 makes it static
            shape: new CANNON.Plane(),
            position: new CANNON.Vec3(0, -900, 0),
        });
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.world.addBody(groundBody);

        // Add desk surface
        const deskBody = new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(3000, 50, 2000)),
            position: new CANNON.Vec3(0, -100, 0),
        });
        this.world.addBody(deskBody);
    }

    addPhysicsBody(
        mesh: THREE.Mesh,
        options: {
            mass?: number;
            shape?: 'box' | 'sphere' | 'cylinder';
            size?: THREE.Vector3;
            radius?: number;
        } = {}
    ): CANNON.Body {
        const mass = options.mass !== undefined ? options.mass : 1;

        // Create shape based on mesh geometry or specified shape
        let shape: CANNON.Shape;

        if (options.shape === 'sphere') {
            const radius = options.radius || 100;
            shape = new CANNON.Sphere(radius);
        } else if (options.shape === 'cylinder') {
            const radius = options.radius || 100;
            shape = new CANNON.Cylinder(radius, radius, 200, 8);
        } else {
            // Default to box
            const size = options.size || new THREE.Vector3(100, 100, 100);
            shape = new CANNON.Box(
                new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)
            );
        }

        // Create body
        const body = new CANNON.Body({
            mass: mass,
            shape: shape,
            position: new CANNON.Vec3(
                mesh.position.x,
                mesh.position.y,
                mesh.position.z
            ),
            linearDamping: 0.3,
            angularDamping: 0.3,
        });

        // Copy rotation
        body.quaternion.set(
            mesh.quaternion.x,
            mesh.quaternion.y,
            mesh.quaternion.z,
            mesh.quaternion.w
        );

        this.world.addBody(body);
        this.physicsBodies.set(mesh, body);

        return body;
    }

    applyForce(mesh: THREE.Mesh, force: THREE.Vector3, worldPoint?: THREE.Vector3) {
        const body = this.physicsBodies.get(mesh);
        if (!body) return;

        const forceVec = new CANNON.Vec3(force.x, force.y, force.z);

        if (worldPoint) {
            const point = new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z);
            body.applyForce(forceVec, point);
        } else {
            body.applyForce(forceVec);
        }
    }

    applyImpulse(mesh: THREE.Mesh, impulse: THREE.Vector3, worldPoint?: THREE.Vector3) {
        const body = this.physicsBodies.get(mesh);
        if (!body) return;

        const impulseVec = new CANNON.Vec3(impulse.x, impulse.y, impulse.z);

        if (worldPoint) {
            const point = new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z);
            body.applyImpulse(impulseVec, point);
        } else {
            body.applyImpulse(impulseVec);
        }
    }

    removePhysicsBody(mesh: THREE.Mesh) {
        const body = this.physicsBodies.get(mesh);
        if (body) {
            this.world.removeBody(body);
            this.physicsBodies.delete(mesh);
        }
    }

    update(deltaTime: number) {
        // Step physics world
        this.world.step(this.timeStep, deltaTime, 3);

        // Update Three.js meshes to match physics bodies
        this.physicsBodies.forEach((body, mesh) => {
            mesh.position.copy(body.position as any);
            mesh.quaternion.copy(body.quaternion as any);
        });
    }
}
