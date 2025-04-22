import admin from 'firebase-admin';
import db from '../config/firebase.js';

export async function createFamily({ name, creatorPhone }) {
  const ref = db.collection('families').doc();
  await ref.set({
    name,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    members: [creatorPhone],
    admins: [creatorPhone],
  });
  return ref.id;
}

export async function addUserToFamily(familyId, phone) {
  await db.collection('families').doc(familyId).update({
    members: admin.firestore.FieldValue.arrayUnion(phone),
  });
}

export async function promoteUserToAdmin(familyId, phone) {
  await db.collection('families').doc(familyId).update({
    admins: admin.firestore.FieldValue.arrayUnion(phone),
  });
}

export async function removeUserFromFamily(familyId, phone) {
  await db.collection('families').doc(familyId).update({
    members: admin.firestore.FieldValue.arrayRemove(phone),
    admins: admin.firestore.FieldValue.arrayRemove(phone),
  });
}

export async function findFamilyByUser(phone) {
  const snapshot = await db.collection('families')
    .where('members', 'array-contains', phone)
    .limit(1)
    .get();
  return snapshot.empty ? null : snapshot.docs[0];
}

export async function listFamilyMembers(familyId) {
  const doc = await db.collection('families').doc(familyId).get();
  if (!doc.exists) return [];
  
  const data = doc.data();
  const members = data.members || [];
  const admins = new Set(data.admins || []);
  
  // Get profiles for all members
  const membersWithProfiles = await Promise.all(
    members.map(async phone => {
      const profile = await getUserProfile(phone);
      return {
        phone,
        name: profile?.name || phone,
        isAdmin: admins.has(phone)
      };
    })
  );

  return membersWithProfiles.map(({name, isAdmin, phone}) => 
    `${isAdmin ? '👑' : '•'} ${name} (${phone})`
  );
}

export async function isUserAdmin(familyId, userId) {
  const doc = await db.collection('families').doc(familyId).get();
  return doc.data().admins.includes(userId);
}

export async function getFamilyById(familyId) {
  const doc = await db.collection('families').doc(familyId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function updateUserProfile(phoneNumber, profileName) {
  const userRef = db.collection('users').doc(phoneNumber);
  await userRef.set({
    name: profileName,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

export async function getUserProfile(phoneNumber) {
  const snap = await db.collection('users').doc(phoneNumber).get();
  return snap.exists ? snap.data() : null;
}

export async function deleteFamily(familyId) {
  await db.collection('families').doc(familyId).delete();
} 

export async function demoteUserFromAdmin(familyId, phone) {
  await db.collection('families').doc(familyId).update({
    admins: admin.firestore.FieldValue.arrayRemove(phone),
  });
}