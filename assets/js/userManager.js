export async function loadUsers(){
  const dummy=[{user_id:'U1',name:'박지성',contact:'010-1234-5678',ftp:242,weight:56},{user_id:'U2',name:'박선호',contact:'010-9876-5432',ftp:200,weight:70}];
  displayUsers(dummy);
}
export function displayUsers(users){
  const list=document.getElementById('profileList');list.innerHTML='';
  users.forEach(u=>{const d=document.createElement('div');d.className='card profile-card';d.onclick=()=>selectUser(u);
    const initials=u.name.substring(0,2);const wkg=(u.ftp/u.weight).toFixed(1);
    d.innerHTML=`<div class="profile-info"><div class="profile-avatar">${initials}</div><div class="profile-details"><h3>${u.name}</h3><div class="profile-stats"><div><div class="stat-value">${u.ftp}W</div><div class="stat-label">FTP</div></div><div><div class="stat-value">${u.weight}kg</div><div class="stat-label">몸무게</div></div><div><div class="stat-value">${wkg}</div><div class="stat-label">W/kg</div></div></div></div></div>`;
    list.appendChild(d);});
}
export function showAddUserForm(){document.getElementById('addUserForm').classList.remove('hidden');}
export function cancelAddUser(){document.getElementById('addUserForm').classList.add('hidden');['userName','userContact','userFTP','userWeight'].forEach(id=>document.getElementById(id).value='');}
export async function saveNewUser(){alert('GAS 연동 시 저장됩니다. 데모에서는 생략.');}
export function selectUser(user){window.currentUser=user;alert(`${user.name}님, 환영합니다!`);window.showScreen('workoutScreen');}
export function showUserInfo(){}