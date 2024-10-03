import { asyncHandler } from "../utils/asyncHandler.js"
import {ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.model.js"
import {uploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"


const generateAccessAndRefreshTokens = async(userId) => {
     try {
          const user = await User.findById(userId)
          const accessToken = user.generateAccessToken()
          const refreshToken = user.generateRefreshToken()

          user.refreshToken = refreshToken
          await user.save({validateBeforeSave: false})

          return {
               accessToken,
               refreshToken
          }
     } catch (error) {
          throw new ApiError(500,"Something went wrong while generating tokens")
     }
}

const registerUser = asyncHandler( async(req,res) => {

   // get user details from frontend

   const{fullName, email, username, password} =  req.body
   // console.log("email: ", email);

   // validation - not empty

   if (
        [fullName, email, username, password].some((field) => field?.trim() === "")
   ) {
        throw new ApiError(400,"All fields are required")
   }

   // check if user already exists: username, email

   const existedUser = await User.findOne({
        $or: [{ username }, { email }]
   })

   if(existedUser){
    throw new ApiError(409,"User with email and username already exists")
   }

   // check for images, check for avatar

   const avatarLocalPath = req.files?.avatar[0]?.path
//    const coverImageLocalPath = req.files?.coverImage[0]?.path
   let coverImageLocalPath;
   if(req.files && Array.isArray(req.files.coverImage) &&  req.files.coverImage.length > 0){
     coverImageLocalPath = req.files.coverImage[0].path
   }


   if(!avatarLocalPath){
    throw new ApiError(400,"Avatar is required")
   }

   // upload them to cloudnary, avatar

   const avatar = await uploadOnCloudinary(avatarLocalPath)
   const coverImage = await uploadOnCloudinary(coverImageLocalPath)
   if(!avatar){
    throw new ApiError(400,"Avatar upload failed")
   }

   // create user object - create entry in db

   const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
   })

   // remove password and refresh token field from response

   const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
   )

   // check for user creation

   if(!createdUser){
    throw new ApiError(500,"User creation failed")
   }

   // return response

   return res.status(201).json(
    new ApiResponse(200, createdUser, "User registred successfully")
   )

} )


const loginUser = asyncHandler(async (req,res) => {

     // req body se data get karne ke liye
     
     const {email, username, password} = req.body

     // username or email mein kisi se login karne ke liye

     if(!username && !email){
          throw new ApiError(400, "Username or email is required")
     }

     // find the user from db

     const user = await User.findOne({
          $or: [{ username }, { email }]
     })
     
     if(!user){
          throw new ApiError(400, "User not found")
     }

     // password check

     const isPasswordValid = await user.isPasswordCorrect(password)

     if(!isPasswordValid){
          throw new ApiError(401, "Incorrect password")
     }

     // generate access token and refresh token

     const {accessToken,refreshToken} =  await generateAccessAndRefreshTokens(user._id)

     const loggedInUser = await User.findById(user._id).select(
          "-password -refreshToken"
     )

     // send token in cookies

     const options = {
          httpOnly: true,
          secure: true
     }

     return res
     .status(200)
     .cookie("accessToken", accessToken, options)
     .cookie("refreshToken", refreshToken, options)
     .json(
          new ApiResponse(
               200,
               {
                    user: loggedInUser,accessToken,refreshToken
               },
               "User logged in successfully"
          )
     )
})

const logoutUser = asyncHandler(async(req,res) => {

     // Clear cookies and send response
     await User.findByIdAndUpdate(req.user._id, {
          $unset: {
               refreshToken: 1
          }
     },
     {
          new: true
     }

     )

     const options = {
          httpOnly: true,
          secure: true
     }

     return res
     .status(200)
     .clearCookie("accessToken", options)
     .clearCookie("refreshToken", options)
     .json(
          new ApiResponse(
               200,
               {},
               "User logged out successfully"
          )
     )
})


const refreshAccessToken = asyncHandler(async(req,res) => {
     const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

     if(!incomingRefreshToken){
          throw new ApiError(401, "Unauthorized request")
     }

     try {
          const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
     
          const user = await User.findById(decodedToken?._id)
     
          if(!user){
               throw new ApiError(401, "Invalid Refresh Token")
          }
     
          if(incomingRefreshToken !==  user?.refreshToken){
               throw new ApiError(401, "Refresh token is expired or used")
          }
     
          const options = {
               httpOnly: true,
               secure: true
          }
     
          const {accessToken,newRefreshToken} = await generateAccessAndRefreshTokens(user._id)
     
          return res
          .status(200)
          .cookie("accessToken", accessToken, options)
          .cookie("refreshToken", newRefreshToken, options)
          .json(
               new ApiResponse(
                    200,
                    {
                         accessToken,newRefreshToken
                    },
                    "Access token refreshed successfully"
               )
          )
     } catch (error) {
          throw new ApiError(401, error?.message || "Invalid Refresh Token")
     }
})



const changeCurrentPassword = asyncHandler(async(req,res)=>{
     const{oldPassword, newPassword} = req.body

     const user = await User.findById(req.user?._id)
     const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

     if(!isPasswordCorrect){
          throw new ApiError(400, "Old password is incorrect")
     }

     user.password = newPassword
     await user.save({validateBeforeSave: false})
     return res
     .status(200)
     .json(new ApiResponse(200, {}, "Password changed successfully"))
})


const getCurentUser = asyncHandler(async(req,res) => {
     return res
     .status(200)
     .json(new ApiResponse(200, req.user,"current user fetched successfully"))

})


const updateAccountDetails = asyncHandler(async(req,res) => {
     const{fullName,email} = req.body

     if(!fullName || !email){
          throw new ApiError(400, "All fields are required")
     }    

     const user = await User.findByIdAndUpdate(
          req.user?._id,
          {
               $set: {
                    fullName,
                    email: email
               }
          },
          {new: true}
     ).select("-password")
     return res
     .status(200)
     .json(new ApiResponse(200, user, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async(req,res) => {

     const avatarLocalPath = req.file?.path
     if(!avatarLocalPath){
          throw new ApiError(400, "Avatar is required")
     }

     const avatar = await uploadOnCloudinary(avatarLocalPath)
     
     if(!avatar.url){
          throw new ApiError(400, "Avatar upload failed")
     }

     const user = await user.findByIdAndUpdate(
          req.user?._id,
          {
               $set: {
                    avatar: avatar.url
               }
          },
          {new: true}
     ).select("-password")
     return res
     .status(200)
     .json(new ApiResponse(200, user, "Avatar updated successfully"))
})

const updateUserCoverImage = asyncHandler(async(req,res) => {

     const coverLocalPath = req.file?.path
     if(!coverLocalPath){
          throw new ApiError(400, "Cover Image is required")
     }

     const coverImage = await uploadOnCloudinary(avatarLocalPath)
     
     if(!coverImage.url){
          throw new ApiError(400, "Cover Image upload failed")
     }

     const user = await user.findByIdAndUpdate(
          req.user?._id,
          {
               $set: {
                    coverImage: coverImage.url
               }
          },
          {new: true}
     ).select("-password")

     return res
     .status(200)
     .json(new ApiResponse(200, user, "Cover image updated successfully"))
})


const getUserChannelProfile = asyncHandler(async(req,res) => {
     const {username} = req.params

     if(!username?.trim()){
          throw new ApiError(400, "Username is required")
     }

     const channel = await User.aggregate([
          {
               $match: {
                    username: username?.toLowerCase()
               }
          },
          {
               $lookup: {
                    from: "subscriptions",
                    localField: "_id",
                    foreignField: "channel",
                    as: "subscribers"
               }
          },
          {
               $lookup: {
                    from: "subscriptions",
                    localField: "_id",
                    foreignField: "subscriber",
                    as: "subscribedTo"
               }
          },
          {
               $addFields:{
                    subscribersCount: {
                         $size: "$subscribers"
                    },

                    channelsSubscribedToCount: {
                         $size: "$subscribedTo"
                    },

                    isSubscribed: {
                         $condition: {
                              if: {
                                   $in: [req.user?._id, "$subscribers.subscriber"]
                              },
                              then: true,
                              else: false
                         }
                    }
               }
          },

          {
               $project: {
                    fullName: 1,
                    username: 1,
                    subscribersCount: 1,
                    channelsSubscribedToCount: 1,
                    isSubscribed: 1,
                    avatar: 1,
                    coverImage: 1,
                    email: 1
               }
          }

     ])

     if(!channel?.length){
          throw new ApiError(404, "Channel does not exist")
     }

     return res
     .status(200)
     .json(new ApiResponse(200, channel[0], "Channel profile fetched successfully"))
})

const getWatchHistory = asyncHandler(async(req,res) => {
     const user = await User.aggregate([
          {
               $match: {
                    _id: new mongoose.Types.ObjectId(req.user._id)
               }
          },
          {
               $lookup: {
                    from: "videos",
                    localField: "watchHistory",
                    foreignField: "_id",
                    as: "watchHistory",
                    pipeline: [
                         {
                              $lookup: {
                                   from: "users",
                                   localField: "owner",
                                   foreignField: "_id",
                                   as: "owner",
                                   pipeline: [
                                        {
                                             $project: {
                                                  fullName: 1,
                                                  username: 1,
                                                  avatar: 1
                                             }
                                        }
                                   ]
                              }
                         },
                         {
                              $addFields: {
                                   owner:{
                                        $first: "$owner"
                                   }
                              }

                         }

                    ]
               }

          }
     ])
     return res
     .status(200)
     .json(new ApiResponse(
          200,
          user[0].watchHistory,
          "Watch history fetched successfully"
     ))
})


export {
     registerUser,
     loginUser,
     logoutUser,
     refreshAccessToken,
     changeCurrentPassword,
     getCurentUser,
     updateAccountDetails,
     updateUserAvatar,
     updateUserCoverImage,
     getUserChannelProfile,
     getWatchHistory
}