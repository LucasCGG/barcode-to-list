export async function demoteUserFromAdmin(familyId, phone) {
  await db.collection('families').doc(familyId).update({
    admins: admin.firestore.FieldValue.arrayRemove(phone),
  });
} 