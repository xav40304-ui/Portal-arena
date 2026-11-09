import * as THREE from 'three';
import { joinRoom } from 'trystero';

// Safe Trystero setup block with fallback protection
let room, sendMove, getMove, sendPortal, getPortal;
try {
    const config = { appId: 'portal-sniper-arena-v3' };
    room = joinRoom(config, 'global-arena');
    [sendMove, getMove] = room.makeAction('move');
    [sendPortal, getPortal] = room.makeAction('portal');
} catch(e) {
    console.log("Multiplayer network offline or sandbox layout active:", e);
}

let scene, camera, renderer, floor;
let player, players = {};
let moveJoystick = { x: 0, y: 0 };
let currentWeapon = 'AR'; 
let portals = { blue: null, orange: null };
let gameStarted = false;

document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('start-overlay').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    gameStarted = true;
    init();
});

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f3); 
    
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(30, 50, 20);
    scene.add(dirLight);

    createArena();

    player = new THREE.Group();
    player.position.set(0, 1.6, 0); 
    scene.add(player);
    player.add(camera); 

    setupMobileControls();
    setupNetworking();
    animate();
}

function createArena() {
    const floorGeo = new THREE.PlaneGeometry(120, 120);
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xdcdde1 });
    floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const boxGeo = new THREE.BoxGeometry(8, 10, 8);
    const boxMat = new THREE.MeshLambertMaterial({ color: 0x718093 });
    
    const positions = [
        [-20, 5, -20], [25, 5, -25], [-25, 5, 25], [0, 5, -30],
    ];

    positions.forEach(pos => {
        const block = new THREE.Mesh(boxGeo, boxMat);
        block.position.set(pos, pos, pos);
        scene.add(block);
    });
}

function setupMobileControls() {
    let lookTouchId = null;
    let lastTouchX = 0, lastTouchY = 0;
    const knob = document.getElementById('joystick-knob');

    const joyZone = document.getElementById('joystick-zone');
    joyZone.addEventListener('touchstart', (e) => { e.preventDefault(); }, {passive: false});
    joyZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = joyZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const dist = Math.min(Math.sqrt(dx*dx + dy*dy), 50);
        
        const angle = Math.atan2(dy, dx);
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        
        knob.style.transform = `translate(${tx}px, ${ty}px)`;
        
        moveJoystick.x = tx / 50;
        moveJoystick.y = -(ty / 50);
    }, {passive: false});
    
    joyZone.addEventListener('touchend', () => {
        knob.style.transform = 'translate(0px, 0px)';
        moveJoystick = { x: 0, y: 0 };
    });

    window.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.clientX > window.innerWidth / 2) { 
                if (lookTouchId === null) {
                    lookTouchId = touch.identifier;
                    lastTouchX = touch.clientX;
                    lastTouchY = touch.clientY;
                }
            }
        }
    });

    window.addEventListener('touchmove', (e) => {
        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            if (touch.identifier === lookTouchId) {
                const movementX = touch.clientX - lastTouchX;
                const movementY = touch.clientY - lastTouchY;

                player.rotation.y -= movementX * 0.007; 
                camera.rotation.x -= movementY * 0.007; 
                camera.rotation.x = Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, camera.rotation.x));

                lastTouchX = touch.clientX;
                lastTouchY = touch.clientY;
            }
        }
    });

    window.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null;
        }
    });

    document.getElementById('btn-swap').addEventListener('click', () => {
        currentWeapon = currentWeapon === 'AR' ? 'Sniper' : 'AR';
        document.getElementById('weapon-status').innerText = currentWeapon === 'AR' ? 'Assault Rifle' : 'Sniper Rifle';
    });

    document.getElementById('btn-fire').addEventListener('click', fireWeapon);
    document.getElementById('btn-portalA').addEventListener('click', () => shootPortal('blue'));
    document.getElementById('btn-portalB').addEventListener('click', () => shootPortal('orange'));
}

function fireWeapon() {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
         console.log("Struck target:", intersects[0].object.name);
    }
}

function shootPortal(type) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const intersects = raycaster.intersectObjects(scene.children);

    if (intersects.length > 0 && intersects[0].object !== floor) {
        const hit = intersects[0];
        if (portals[type]) scene.remove(portals[type]);

        const portalGeo = new THREE.RingGeometry(1.2, 1.5, 32);
        const portalMat = new THREE.MeshBasicMaterial({ 
            color: type === 'blue' ? 0x00a8ff : 0xeccc68, 
            side: THREE.DoubleSide 
        });
        const portalMesh = new THREE.Mesh(portalGeo, portalMat);
        
        portalMesh.position.copy(hit.point).add(hit.face.normal.clone().multiplyScalar(0.05));
        portalMesh.lookAt(hit.point.clone().add(hit.face.normal));
        
        scene.add(portalMesh);
        portals[type] = portalMesh;

        if(sendPortal) {
            sendPortal({ type, pos: hit.point.toArray(), norm: hit.face.normal.toArray() });
        }
    }
}

function setupNetworking() {
    if (!room) return;
    room.onPeerJoin(peerId => {
        const avatarGeo = new THREE.BoxGeometry(2, 3, 2);
        const avatarMat = new THREE.MeshLambertMaterial({ color: 0xff6b81 });
        const avatar = new THREE.Mesh(avatarGeo, avatarMat);
        scene.add(avatar);
        players[peerId] = avatar;
    });

    room.onPeerLeave(peerId => {
        if (players[peerId]) {
            scene.remove(players[peerId]);
            delete players[peerId];
        }
    });

    if (getMove) {
        getMove((data, peerId) => {
            if (players[peerId]) {
                players[peerId].position.fromArray(data.pos);
                players[peerId].rotation.fromArray(data.rot);
            }
        });
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (!gameStarted) return;

    const speed = 0.12;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion);
    
    player.position.add(forward.multiplyScalar(moveJoystick.y * speed));
    player.position.add(side.multiplyScalar(moveJoystick.x * speed));

    Object.keys(portals).forEach(color => {
        if(portals.blue && portals.orange) {
            const distance = player.position.distanceTo(portals[color].position);
            if(distance < 2.0) { 
                const exitPortal = color === 'blue' ? portals.orange : portals.blue;
                player.position.copy(exitPortal.position).add(new THREE.Vector3(0, 0, 2));
            }
        }
    });

    if(sendMove) {
        sendMove({
            pos: player.position.toArray(),
            rot: player.rotation.toArray()
        });
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
