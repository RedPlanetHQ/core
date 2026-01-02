import { prisma } from "~/db.server";

export const getInvitation = async (id: string) => {
  return await prisma.invitationCode.findUnique({
    where: {
      id,
    },
  });
};

export const linkWhatsappInvitation = async (
  userId: string,
  id: string,
  phoneNumber: string,
) => {
  return await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      InvitationCode: {
        connect: {
          id,
        },
      },
      phoneNumber,
    },
  });
};
